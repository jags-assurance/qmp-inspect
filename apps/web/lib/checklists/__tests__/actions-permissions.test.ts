import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const notify = vi.hoisted(() => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => notify);
// Collaborators of checklists/actions.ts that are not under test and pull in heavy SDKs / large graphs.
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
vi.mock("@/lib/punch-list/actions", () => ({ createPunchItemFromSource: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => ({ nextSequenceNumber: vi.fn(), generateDocumentNumber: vi.fn() }));
vi.mock("@/lib/vault/irn-void", () => ({ supersedeIrnVaultDocuments: vi.fn() }));
vi.mock("@/lib/signoff/actions", () => ({ canCompleteInspection: vi.fn(async () => true) }));
vi.mock("../irn-notifications", () => ({ notifyAfterIrnIssued: vi.fn(), notifyAfterIrnVoided: vi.fn() }));
vi.mock("../inspection-notifications", () => ({ notifyInspectionStarted: vi.fn(), notifyInspectionPassed: vi.fn() }));
vi.mock("@/lib/registers/server-check", () => ({
  evaluateRegisterGate: vi.fn(async () => ({ error: null })),
  structuredResponseColumns: vi.fn(async () => ({})),
}));

import { saveChecklistResponseAction } from "../actions";
import { cloneLastAnswersAction } from "../clone-actions";
import { reviewInspectionAction } from "../review-actions";
import { waiveWitnessNoticeAction } from "../waiver-actions";

type Mock = ReturnType<typeof resetTestCtx>;

// ---------------------------------------------------------------------------------------------
describe("reviewInspectionAction", () => {
  let mock: Mock;
  const record = (over: Record<string, unknown> = {}) => ({
    id: "rec-1",
    project_id: "proj-1",
    record_number: "INS-001",
    activity: "Concrete pour",
    inspector_id: "inspector-9",
    signed_by_user_id: "signer-9",
    overall_result: "pass",
    review_status: null,
    ...over,
  });
  const review = (over: Record<string, string> = {}) =>
    reviewInspectionAction({ error: null }, formData({ inspection_record_id: "rec-1", decision: "approve", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "reviewer-1" }));
    audit.recordAuditEvent.mockClear();
    notify.createNotification.mockClear();
    mock.on("inspection_records", "select", { data: record() });
    mock.on("inspection_records", "update", { data: [{ id: "rec-1" }] });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
  });

  it("validates the decision and the rejection reason before reading anything", async () => {
    expect((await review({ decision: "" })).error).toMatch(/approve or reject/);
    expect((await review({ decision: "reject", comment: "bad" })).error).toMatch(/at least 10/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an external party", async () => {
    testCtx.session = sessions.external();
    expect((await review()).error).toMatch(/Only JAGS staff can review/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("enforces four-eyes against both the inspector and the signer", async () => {
    testCtx.session = sessions.inspector({ userId: "inspector-9" });
    expect((await review()).error).toMatch(/someone else must review/);
    testCtx.session = sessions.inspector({ userId: "signer-9" });
    expect((await review()).error).toMatch(/someone else must review/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("will not review an incomplete or already-approved inspection", async () => {
    mock.on("inspection_records", "select", { data: record({ overall_result: null }) });
    expect((await review()).error).toMatch(/Only a completed inspection/);
    mock.on("inspection_records", "select", { data: record({ review_status: "approved" }) });
    expect((await review()).error).toMatch(/already been approved/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets a different staff member approve and audits", async () => {
    expect((await review()).error).toBeNull();
    const [update] = mock.writes("inspection_records", "update");
    expect(update.payload).toMatchObject({ review_status: "approved", reviewed_by: "reviewer-1", review_comment: null });
    expect(update.filters).toContainEqual(["not", "overall_result", "is", null]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "review_approved" }));
    expect(notify.createNotification).not.toHaveBeenCalled();
  });

  it("notifies the inspector when a review is rejected", async () => {
    expect((await review({ decision: "reject", comment: "Cover depth not recorded" })).error).toBeNull();
    expect(notify.createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserId: "inspector-9", title: "Inspection rejected on review" }));
  });

  it("reports an inspection re-opened mid-review (guarded update touched nothing)", async () => {
    mock.on("inspection_records", "update", { data: [] });
    expect((await review()).error).toMatch(/re-opened/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe("waiveWitnessNoticeAction", () => {
  let mock: Mock;
  const waive = (over: Record<string, string> = {}) =>
    waiveWitnessNoticeAction({ error: null }, formData({ inspection_record_id: "rec-1", reason: "Client agreed by phone on site", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("inspection_records", "select", {
      data: { id: "rec-1", project_id: "proj-1", itp_item_id: "item-1", record_number: "INS-001", overall_result: null, projects: { organization_id: "org-1" } },
    });
    // unnotifiedNonBlockingLevels: org -> non-blocking levels -> pending progress rows.
    mock.on("itp_items", "select", { data: { itp_sections: { itps: { projects: { organization_id: "org-1" } } } } });
    mock.on("intervention_level_types", "select", { data: [{ code: "W", label: "Witness", is_blocking: false }] });
    mock.on("activity_signoff_progress", "select", { data: [{ intervention: "W", status: "pending" }] });
    mock.on("inspection_notice_waivers", "select", { data: [] });
    mock.on("inspection_notice_waivers", "insert", { data: [{ id: "w-1" }] });
  });

  it("refuses non-staff before reading", async () => {
    testCtx.session = sessions.external();
    expect((await waive()).error).toMatch(/Only JAGS staff can waive/);
    expect(mock.calls).toHaveLength(0);
  });

  it("requires a written reason", async () => {
    expect((await waive({ reason: "ok" })).error).toBeTruthy();
    expect(mock.writes()).toHaveLength(0);
  });

  it("will not waive on a completed inspection", async () => {
    mock.on("inspection_records", "select", { data: { id: "rec-1", project_id: "proj-1", itp_item_id: "item-1", record_number: "INS-001", overall_result: "pass", projects: { organization_id: "org-1" } } });
    expect((await waive()).error).toMatch(/already completed/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("will not waive when no un-notified witness point is blocking", async () => {
    mock.on("activity_signoff_progress", "select", { data: [] });
    expect((await waive()).error).toMatch(/No un-notified witness point/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("records an append-only waiver and audits for staff", async () => {
    expect(await waive()).toEqual({ error: null, done: true });
    expect(mock.writeLog()).toEqual(["inspection_notice_waivers.insert"]);
    expect(mock.writes("inspection_notice_waivers", "insert")[0].payload).toMatchObject({ inspection_record_id: "rec-1", intervention: "W", reason: "Client agreed by phone on site" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "witness_notice_waived" }));
  });

  it("reports a second waiver for the same inspection", async () => {
    mock.on("inspection_notice_waivers", "insert", { error: { code: "23505", message: "dup" } });
    expect((await waive()).error).toMatch(/already recorded/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe("cloneLastAnswersAction", () => {
  let mock: Mock;
  const clone = () => cloneLastAnswersAction({ error: null }, formData({ inspection_record_id: "rec-1" }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("inspection_records", "select", (c) =>
      c.columns?.includes("itp_item_id")
        ? { data: { id: "rec-1", project_id: "proj-1", itp_item_id: "item-1", checklist_template_id: "tpl-1", overall_result: null, record_number: "INS-002", projects: { organization_id: "org-1" } } }
        : { data: { id: "rec-0", record_number: "INS-001" } }
    );
    mock.on("checklist_items", "select", { data: [{ id: "ci-1" }, { id: "ci-2" }, { id: "ci-3" }] });
    mock.on("checklist_responses", "select", (c) =>
      c.columns?.includes("result")
        ? { data: [{ checklist_item_id: "ci-1", result: "yes", comment: null }, { checklist_item_id: "ci-2", result: "no", comment: "bad" }, { checklist_item_id: "ci-3", result: "na", comment: " " }] }
        : { data: [] }
    );
    mock.on("checklist_responses", "insert", { data: [] });
  });

  it("refuses a party that is not assigned to the activity", async () => {
    testCtx.session = sessions.external({ userId: "stranger" });
    mock.on("activity_party_intervention", "select", { data: [] });
    expect((await clone()).error).toMatch(/Only JAGS staff or the party assigned/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses a completed inspection", async () => {
    mock.on("inspection_records", "select", { data: { id: "rec-1", project_id: "proj-1", itp_item_id: "item-1", checklist_template_id: "tpl-1", overall_result: "pass", record_number: "INS-002", projects: null } });
    expect((await clone()).error).toMatch(/already completed/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("needs an earlier completed inspection to copy from", async () => {
    mock.on("inspection_records", "select", (c) =>
      c.columns?.includes("itp_item_id")
        ? { data: { id: "rec-1", project_id: "proj-1", itp_item_id: "item-1", checklist_template_id: "tpl-1", overall_result: null, record_number: "INS-002", projects: null } }
        : { data: null }
    );
    expect((await clone()).error).toMatch(/no earlier completed inspection/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets staff copy only Yes / N-A answers (never failures) and audits", async () => {
    const res = await clone();
    expect(res).toEqual({ error: null, copied: 2 });
    const rows = mock.writes("checklist_responses", "insert")[0].payload as { checklist_item_id: string; result: string; comment: string | null }[];
    expect(rows.map((r) => [r.checklist_item_id, r.result])).toEqual([["ci-1", "yes"], ["ci-3", "na"]]);
    expect(rows.find((r) => r.checklist_item_id === "ci-3")?.comment).toBeNull();
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "answers_prefilled" }));
  });

  it("lets the assigned executing party copy too", async () => {
    testCtx.session = sessions.external({ userId: "sub-1" });
    mock.on("activity_party_intervention", "select", { data: [{ project_parties: { id: "p-1", user_id: "sub-1", party_type: "subcontractor", is_active: true } }] });
    mock.on("itp_items", "select", { data: { itp_sections: { itps: { project_id: "proj-1" } } } });
    mock.on("projects", "select", { data: { allow_client_execution: false, organizations: null } });
    expect((await clone()).copied).toBe(2);
  });

  it("never copies a measured (numeric) answer", async () => {
    mock.on("checklist_items", "select", (c) =>
      c.columns?.includes("value_type")
        ? { data: [{ id: "ci-1", value_type: "numeric", numeric_min: 1, numeric_max: 2, numeric_unit: "mm" }] }
        : { data: [{ id: "ci-1" }, { id: "ci-2" }, { id: "ci-3" }] }
    );
    expect((await clone()).copied).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("saveChecklistResponseAction (numeric responses)", () => {
  let mock: Mock;
  const save = (over: Record<string, string> = {}) =>
    saveChecklistResponseAction(formData({ inspection_record_id: "rec-1", checklist_item_id: "ci-1", result: "yes", numeric_value: "15", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    mock.on("inspection_records", "select", { data: { itp_item_id: "item-1", project_id: "proj-1", overall_result: null, checklist_template_id: "tpl-1" } });
    mock.on("checklist_items", "select", (c) =>
      c.columns?.includes("value_type") ? { data: { value_type: "numeric", numeric_min: 10, numeric_max: 20, numeric_unit: "mm" } } : { data: { id: "ci-1" } }
    );
    mock.on("checklist_responses", "select", { data: null });
    mock.on("checklist_responses", "insert", { data: [{ updated_at: "2026-01-01T00:00:00Z" }] });
  });

  it("refuses an external user who is not assigned to the activity, and writes nothing", async () => {
    testCtx.session = sessions.external({ userId: "stranger" });
    mock.on("activity_party_intervention", "select", { data: [] });
    expect((await save()).error).toMatch(/don't have permission/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses a response against a completed inspection", async () => {
    mock.on("inspection_records", "select", { data: { itp_item_id: "item-1", project_id: "proj-1", overall_result: "pass", checklist_template_id: "tpl-1" } });
    expect((await save()).error).toMatch(/already completed/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses an item that is not on this inspection's checklist", async () => {
    mock.on("checklist_items", "select", (c) => (c.columns?.includes("value_type") ? { data: null } : { data: null }));
    expect((await save()).error).toMatch(/not part of this inspection's checklist/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("derives a pass from an in-range number and stores the value", async () => {
    expect((await save({ numeric_value: "15" })).error).toBeNull();
    expect(mock.writes("checklist_responses", "insert")[0].payload).toMatchObject({ result: "yes", numeric_value: 15 });
  });

  it("overrides a client-claimed 'yes' when the reading is out of range, demanding a comment", async () => {
    const res = await save({ numeric_value: "25", result: "yes" });
    expect(res.error).toMatch(/outside the limit \(10 to 20 mm\)/);
    expect(mock.writes()).toHaveLength(0);
    expect((await save({ numeric_value: "25", comment: "Out of tolerance, re-measured" })).error).toBeNull();
    expect(mock.writes("checklist_responses", "insert")[0].payload).toMatchObject({ result: "no", numeric_value: 25 });
  });

  it("rejects a non-numeric reading", async () => {
    expect((await save({ numeric_value: "abc" })).error).toMatch(/as a number/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("keeps N/A as N/A without a value", async () => {
    expect((await save({ result: "na", numeric_value: "" })).error).toBeNull();
    expect(mock.writes("checklist_responses", "insert")[0].payload).toMatchObject({ result: "na", numeric_value: null });
  });

  it("requires a comment for a plain No and rejects invalid values", async () => {
    mock.on("checklist_items", "select", (c) => (c.columns?.includes("value_type") ? { data: { value_type: null } } : { data: { id: "ci-1" } }));
    expect((await save({ result: "no", numeric_value: "" })).error).toMatch(/comment is required/);
    expect((await save({ result: "maybe" })).error).toMatch(/Invalid response value/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("detects a concurrent edit instead of overwriting", async () => {
    mock.on("checklist_responses", "select", { data: { id: "resp-1", updated_at: "2026-02-02T00:00:00Z", updated_by: "other" } });
    const res = await save({ expected_updated_at: "2026-01-01T00:00:00Z" });
    expect(res.conflict).toBeDefined();
    expect(mock.writes()).toHaveLength(0);
  });
});
