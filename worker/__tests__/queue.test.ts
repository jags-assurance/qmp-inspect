import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCtx } from "../../apps/web/lib/test-utils/mock-supabase";

// The worker's Supabase client throws at import without env; replace it with the shared recording fake.
vi.mock("../src/supabase", async () => ({ supabase: (await import("../../apps/web/lib/test-utils/mock-supabase")).testCtx.mock.client }));

import { claimNextPendingJob, markCompleted, markFailed, markRetry, reclaimOrphanedJobs, resetQueueStateForTests, retryNotBeforeFor } from "../src/jobs/queue";
import { retryDelayMs } from "../src/jobs/retryPolicy";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const mock = testCtx.mock;

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  job_type: "render_itp_pdf",
  status: "pending",
  attempts: 0,
  created_at: "2026-11-11T11:00:00Z",
  updated_at: "2026-11-11T11:00:00Z",
  retry_not_before: null,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mock.reset();
  resetQueueStateForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("claimNextPendingJob - atomic RPC path", () => {
  it("returns the job the claim RPC hands back, and never touches the table directly", async () => {
    mock.onRpc("claim_next_background_job", { data: [job({ status: "processing", attempts: 1 })] });
    const claimed = await claimNextPendingJob();
    expect(claimed).toMatchObject({ id: "job-1", status: "processing", attempts: 1 });
    expect(mock.calls).toHaveLength(0);
  });

  it("returns null when the queue is empty", async () => {
    mock.onRpc("claim_next_background_job", { data: [] });
    expect(await claimNextPendingJob()).toBeNull();
  });

  it("treats a transient RPC failure as 'nothing claimed' without falling back", async () => {
    mock.onRpc("claim_next_background_job", { error: { code: "57014", message: "statement timeout" } });
    expect(await claimNextPendingJob()).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  it("two pollers receive different jobs (each RPC call returns its own row)", async () => {
    const rows = [job({ id: "a" }), job({ id: "b" })];
    mock.onRpc("claim_next_background_job", () => ({ data: [rows.shift()] }));
    const [one, two] = await Promise.all([claimNextPendingJob(), claimNextPendingJob()]);
    expect([one?.id, two?.id].sort()).toEqual(["a", "b"]);
  });
});

describe("claimNextPendingJob - compare-and-swap fallback (RPC not installed)", () => {
  beforeEach(() => {
    mock.onRpc("claim_next_background_job", { error: { code: "PGRST202", message: "Could not find the function" } });
  });

  it("falls back, claims the oldest never-attempted job conditioned on status and attempts, and stops calling the RPC", async () => {
    mock.on("background_jobs", "select", { data: [job({ id: "old-retry", attempts: 1, retry_not_before: "2026-11-11T11:00:00Z", created_at: "2026-11-11T08:00:00Z" }), job({ id: "fresh" })] });
    mock.on("background_jobs", "update", (c) => ({ data: [{ ...job(), id: "fresh", status: "processing", attempts: (c.payload as { attempts: number }).attempts }] }));
    const claimed = await claimNextPendingJob();
    expect(claimed?.id).toBe("fresh");
    const [update] = mock.writes("background_jobs", "update");
    expect(update.payload).toMatchObject({ status: "processing", attempts: 1 });
    expect(update.filters).toEqual(expect.arrayContaining([["eq", "id", "fresh"], ["eq", "status", "pending"], ["eq", "attempts", 0]]));

    await claimNextPendingJob();
    expect(mock.rpcCalls).toHaveLength(1);
  });

  it("skips a retry whose persisted backoff has not elapsed", async () => {
    mock.on("background_jobs", "select", { data: [job({ id: "waiting", attempts: 1, retry_not_before: "2026-11-11T12:05:00Z" })] });
    expect(await claimNextPendingJob()).toBeNull();
    expect(mock.writes()).toHaveLength(0);
  });

  it("claims a retry once its backoff has passed", async () => {
    mock.on("background_jobs", "select", { data: [job({ id: "ready", attempts: 1, retry_not_before: "2026-11-11T11:59:00Z" })] });
    mock.on("background_jobs", "update", { data: [job({ id: "ready", status: "processing", attempts: 2 })] });
    expect((await claimNextPendingJob())?.id).toBe("ready");
  });

  it("returns null when another replica won the race (conditional update matched nothing)", async () => {
    mock.on("background_jobs", "select", { data: [job()] });
    mock.on("background_jobs", "update", { data: [] });
    expect(await claimNextPendingJob()).toBeNull();
  });

  it("retries the claim without started_at when that column is missing", async () => {
    mock.on("background_jobs", "select", { data: [job()] });
    mock.onOnce("background_jobs", "update", { error: { message: "column started_at does not exist" } });
    mock.on("background_jobs", "update", { data: [job({ status: "processing", attempts: 1 })] });
    expect((await claimNextPendingJob())?.id).toBe("job-1");
    const updates = mock.writes("background_jobs", "update");
    expect(updates).toHaveLength(2);
    expect(updates[0].payload).toHaveProperty("started_at");
    expect(updates[1].payload).not.toHaveProperty("started_at");
  });

  it("returns null when polling fails", async () => {
    mock.on("background_jobs", "select", { error: { message: "boom" } });
    expect(await claimNextPendingJob()).toBeNull();
  });
});

describe("markRetry (backoff)", () => {
  it("requeues as pending with retry_not_before = now + the exponential delay, only from 'processing'", async () => {
    for (const attempts of [1, 2, 3, 6]) {
      mock.reset();
      expect(await markRetry("job-1", "render crashed", attempts)).toBe(true);
      const [update] = mock.writes("background_jobs", "update");
      expect(update.payload).toMatchObject({ status: "pending", error_message: `Attempt ${attempts} failed, will retry: render crashed` });
      expect(Date.parse((update.payload as { retry_not_before: string }).retry_not_before)).toBe(NOW + retryDelayMs(attempts));
      expect(update.filters).toEqual(expect.arrayContaining([["eq", "id", "job-1"], ["eq", "status", "processing"]]));
    }
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(6)).toBe(15 * 60_000);
  });

  it("falls back to a plain requeue when retry_not_before is not migrated, still holding the in-memory backoff", async () => {
    mock.onOnce("background_jobs", "update", { error: { message: "column retry_not_before does not exist" } });
    expect(await markRetry("job-1", "x", 2)).toBe(true);
    const updates = mock.writes("background_jobs", "update");
    expect(updates[1].payload).not.toHaveProperty("retry_not_before");
    expect(retryNotBeforeFor("job-1")).toBe(NOW + 120_000);
  });

  it("reports failure and records no backoff when the requeue cannot be written", async () => {
    mock.on("background_jobs", "update", { error: { message: "down" } });
    expect(await markRetry("job-1", "x", 1)).toBe(false);
    expect(retryNotBeforeFor("job-1")).toBeUndefined();
  });

  it("truncates a huge error message so the row stays writable", async () => {
    await markRetry("job-1", "e".repeat(5000), 1);
    expect((mock.writes("background_jobs", "update")[0].payload as { error_message: string }).error_message.length).toBeLessThan(2000);
  });

  it("the in-memory backoff keeps a requeued job from being re-claimed too early on the fallback path", async () => {
    mock.onRpc("claim_next_background_job", { error: { code: "42883", message: "does not exist" } });
    await markRetry("job-1", "x", 1);
    // The database row has no retry_not_before (older schema) and a fresh updated_at.
    mock.on("background_jobs", "select", { data: [job({ attempts: 1, updated_at: "2026-11-11T11:00:00Z" })] });
    expect(await claimNextPendingJob()).toBeNull();
    vi.setSystemTime(NOW + 31_000);
    mock.on("background_jobs", "update", { data: [job({ status: "processing", attempts: 2 })] });
    expect((await claimNextPendingJob())?.id).toBe("job-1");
  });
});

describe("markCompleted / markFailed", () => {
  it("only transitions a job that is still processing, so a late finish cannot clobber a timeout", async () => {
    await markCompleted("job-1", "reports/x.pdf");
    await markFailed("job-1", "f".repeat(3000));
    const [done, failed] = mock.writes("background_jobs", "update");
    expect(done.payload).toMatchObject({ status: "completed", result_storage_path: "reports/x.pdf" });
    expect(done.filters).toContainEqual(["eq", "status", "processing"]);
    expect(failed.payload).toMatchObject({ status: "failed" });
    expect((failed.payload as { error_message: string }).error_message).toHaveLength(2000);
    expect(failed.filters).toContainEqual(["eq", "status", "processing"]);
  });
});

describe("reclaimOrphanedJobs", () => {
  const stale = (over: Record<string, unknown> = {}) => ({
    id: "stuck-1",
    job_type: "render_itp_pdf",
    payload: null,
    attempts: 1,
    started_at: "2026-11-11T11:00:00Z",
    created_at: "2026-11-11T10:00:00Z",
    ...over,
  });

  it("requeues an orphan that still has attempts left", async () => {
    mock.on("background_jobs", "select", { data: [stale({ attempts: 1 })] });
    await reclaimOrphanedJobs();
    const [update] = mock.writes("background_jobs", "update");
    expect(update.payload).toMatchObject({ status: "pending" });
    expect(update.filters).toEqual(expect.arrayContaining([["eq", "id", "stuck-1"], ["eq", "status", "processing"]]));
  });

  it("fails an orphan that has used all its attempts", async () => {
    mock.on("background_jobs", "select", { data: [stale({ attempts: 3 })] });
    await reclaimOrphanedJobs();
    expect(mock.writes("background_jobs", "update")[0].payload).toMatchObject({ status: "failed", error_message: expect.stringContaining("Orphaned") });
  });

  it("leaves a job alone while it is within its own type's timeout (Data Book gets 20 minutes)", async () => {
    mock.on("background_jobs", "select", {
      data: [
        stale({ id: "databook", job_type: "render_data_book_pdf", started_at: new Date(NOW - 10 * 60_000).toISOString() }),
        stale({ id: "fresh", started_at: new Date(NOW - 60_000).toISOString() }),
      ],
    });
    await reclaimOrphanedJobs();
    expect(mock.writes()).toHaveLength(0);
  });

  it("reclaims a Data Book once it exceeds its long budget", async () => {
    mock.on("background_jobs", "select", { data: [stale({ job_type: "render_data_book_pdf", started_at: new Date(NOW - 25 * 60_000).toISOString() })] });
    await reclaimOrphanedJobs();
    expect(mock.writes("background_jobs", "update")).toHaveLength(1);
  });

  it("measures from created_at when started_at is missing, and falls back when that column is not migrated", async () => {
    mock.on("background_jobs", "select", (c) =>
      c.filters.some((f) => f[0] === "or") ? { error: { message: "column started_at does not exist" } } : { data: [stale({ started_at: undefined, created_at: new Date(NOW - 30 * 60_000).toISOString() })] }
    );
    await reclaimOrphanedJobs();
    expect(mock.calls.filter((c) => c.op === "select")).toHaveLength(2);
    expect(mock.writes("background_jobs", "update")).toHaveLength(1);
  });

  it("does nothing when the lookup itself fails", async () => {
    mock.on("background_jobs", "select", { error: { message: "down" } });
    await reclaimOrphanedJobs();
    expect(mock.writes()).toHaveLength(0);
  });
});
