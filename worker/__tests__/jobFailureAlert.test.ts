import { beforeEach, describe, expect, it, vi } from "vitest";
import { testCtx } from "../../apps/web/lib/test-utils/mock-supabase";

vi.mock("../src/supabase", async () => ({ supabase: (await import("../../apps/web/lib/test-utils/mock-supabase")).testCtx.mock.client }));

import { buildFailureAlert, failureAlertLink, isMissingFailureColumn, scopeFromPayload, shouldAlertOnFailure, summariseError } from "../src/jobs/jobFailurePolicy";
import { alertPermanentJobFailure, sweepUnnotifiedFailedJobs } from "../src/jobs/jobFailureAlert";

const mock = testCtx.mock;
const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  job_type: "generate_weekly_report_pack",
  status: "failed",
  attempts: 3,
  error_message: "boom for jane.doe@example.com",
  payload: { organization_id: ORG, project_id: PROJECT } as Record<string, unknown> | null,
  ...over,
});

describe("shouldAlertOnFailure (pure)", () => {
  it("alerts only for a terminally failed job nobody was told about", () => {
    expect(shouldAlertOnFailure(job())).toBe(true);
    expect(shouldAlertOnFailure(job({ status: "pending" }))).toBe(false); // being retried
    expect(shouldAlertOnFailure(job({ status: "processing" }))).toBe(false);
    expect(shouldAlertOnFailure(job({ status: "completed" }))).toBe(false);
    expect(shouldAlertOnFailure(job({ failure_notified_at: "2026-11-22T00:00:00Z" }))).toBe(false); // exactly once
  });
});

describe("buildFailureAlert / summariseError / helpers (pure)", () => {
  it("scrubs emails and tokens, caps length and carries job type, id, project and a same-site link", () => {
    const a = buildFailureAlert(job({ error_message: `x@y.com Bearer abcdefghijklmnop ${"z".repeat(1000)}` }), "P-1 Tank Farm");
    expect(a.title).toContain("Weekly report pack");
    expect(a.body).toContain("job-1");
    expect(a.body).toContain("P-1 Tank Farm");
    expect(a.body).toContain("3 attempts");
    expect(a.body).not.toContain("x@y.com");
    expect(a.body).not.toContain("abcdefghijklmnop");
    expect(a.body.length).toBeLessThan(500);
    expect(a.link).toBe(failureAlertLink("job-1"));
    expect(a.link).toMatch(/^\/([^/\\]|$)/);
  });
  it("handles missing messages and unknown job types without throwing", () => {
    expect(summariseError(null)).toBe("No error message recorded.");
    expect(buildFailureAlert(job({ job_type: "mystery", attempts: 1, error_message: undefined }), null).title).toContain("mystery");
  });
  it("reads scope from a payload and detects a missing column", () => {
    expect(scopeFromPayload({ organization_id: ORG, project_id: PROJECT })).toEqual({ organizationId: ORG, projectId: PROJECT });
    expect(scopeFromPayload(null)).toEqual({ organizationId: null, projectId: null });
    expect(isMissingFailureColumn({ code: "42703", message: "x" })).toBe(true);
    expect(isMissingFailureColumn({ message: 'column "failure_notified_at" does not exist' })).toBe(true);
    expect(isMissingFailureColumn({ code: "57014", message: "timeout" })).toBe(false);
    expect(isMissingFailureColumn(null)).toBe(false);
  });
});

function wireAdmins() {
  mock.on("projects", "select", { data: { organization_id: ORG, project_number: "P-1", name: "Tank Farm" } });
  mock.on("access_grants", "select", { data: [{ user_id: "admin-1", scope_type: "global", organization_id: null }, { user_id: "admin-2", scope_type: "organization", organization_id: ORG }] });
  mock.on("users", "select", { data: [{ id: "admin-1" }, { id: "admin-2" }] });
}

describe("alertPermanentJobFailure", () => {
  beforeEach(() => {
    mock.reset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("claims the job first, then notifies every admin once", async () => {
    wireAdmins();
    expect(await alertPermanentJobFailure(job())).toBe(true);
    const log = mock.writeLog();
    expect(log[0]).toBe("background_jobs.update"); // claim before any notification
    const notes = mock.writes("notifications", "insert");
    expect(notes).toHaveLength(2);
    expect(notes[0].payload).toMatchObject({ organization_id: ORG, project_id: PROJECT, recipient_user_id: "admin-1" });
    expect(String((notes[0].payload as { body: string }).body)).not.toContain("jane.doe@example.com");
    const claim = mock.writes("background_jobs", "update")[0];
    expect(claim.filters).toEqual(expect.arrayContaining([["eq", "id", "job-1"], ["is", "failure_notified_at", null]]));
  });

  it("does not notify when the claim finds the job already notified (sweep / retry / second replica)", async () => {
    wireAdmins();
    mock.on("background_jobs", "update", { data: [] });
    expect(await alertPermanentJobFailure(job())).toBe(false);
    expect(mock.writes("notifications")).toHaveLength(0);
  });

  it("does nothing for a row already stamped as notified", async () => {
    wireAdmins();
    expect(await alertPermanentJobFailure(job({ failure_notified_at: "2026-11-22T00:00:00Z" }))).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });

  it("before the migration: dedupes on the notification link and still alerts once", async () => {
    wireAdmins();
    mock.on("background_jobs", "update", { error: { code: "42703", message: 'column "failure_notified_at" does not exist' } });
    expect(await alertPermanentJobFailure(job())).toBe(true);
    expect(mock.writes("notifications", "insert")).toHaveLength(2);

    mock.reset();
    wireAdmins();
    mock.on("background_jobs", "update", { error: { code: "42703", message: "failure_notified_at missing" } });
    mock.on("notifications", "select", { data: [{ id: "n1" }] });
    expect(await alertPermanentJobFailure(job())).toBe(false);
    expect(mock.writes("notifications")).toHaveLength(0);
  });

  it("never throws into the job loop, and gives the claim back when nobody could be told", async () => {
    mock.on("projects", "select", () => {
      throw new Error("db down");
    });
    await expect(alertPermanentJobFailure(job())).resolves.toBe(false);

    mock.reset();
    wireAdmins();
    mock.on("notifications", "insert", { error: { message: "rls" } });
    // notify() ignores the insert error object, so force a throw instead
    mock.on("notifications", "insert", () => {
      throw new Error("insert exploded");
    });
    await expect(alertPermanentJobFailure(job())).resolves.toBe(false);
    const updates = mock.writes("background_jobs", "update");
    expect(updates[updates.length - 1].payload).toEqual({ failure_notified_at: null });
  });

  it("skips (without throwing) when the organisation cannot be resolved", async () => {
    expect(await alertPermanentJobFailure(job({ payload: { requested_by: "u" } }))).toBe(false);
    expect(mock.writes("notifications")).toHaveLength(0);
  });
});

describe("sweepUnnotifiedFailedJobs", () => {
  beforeEach(() => {
    mock.reset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  it("is a quiet no-op when the column is not migrated (the lookup errors)", async () => {
    mock.on("background_jobs", "select", { error: { message: "column failure_notified_at does not exist" } });
    expect(await sweepUnnotifiedFailedJobs()).toBe(0);
    expect(mock.writes()).toHaveLength(0);
  });
  it("alerts each recent failed job that was never notified", async () => {
    wireAdmins();
    mock.on("background_jobs", "select", { data: [job({ id: "a" }), job({ id: "b" })] });
    expect(await sweepUnnotifiedFailedJobs()).toBe(2);
  });
});
