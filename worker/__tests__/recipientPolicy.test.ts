import { describe, expect, it } from "vitest";
import { firstNonEmptyLayer, reminderOutcome } from "../src/recipientPolicy";
import { isOrphaned, orphanDecision } from "../src/jobs/orphanPolicy";
import { MAX_JOB_ATTEMPTS, jobTimeoutMs } from "../src/jobs/retryPolicy";

describe("firstNonEmptyLayer", () => {
  it("picks the first layer with anyone, de-duplicated", () => {
    expect(firstNonEmptyLayer([[], [null, "a", "a"], ["b"]])).toEqual(["a"]);
  });
  it("returns [] when every layer is empty", () => {
    expect(firstNonEmptyLayer([[], [undefined, ""]])).toEqual([]);
  });
});

describe("reminderOutcome", () => {
  it("is no_recipient with nobody, failed when nothing was written, sent otherwise", () => {
    expect(reminderOutcome(0, 0)).toBe("no_recipient");
    expect(reminderOutcome(3, 0)).toBe("failed");
    expect(reminderOutcome(3, 1)).toBe("sent");
  });
});

describe("orphan policy", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const job = (over: Partial<Parameters<typeof orphanDecision>[0]> = {}) => ({
    id: "j", job_type: "render_itp_pdf", payload: null, attempts: 1, created_at: "2026-10-14T00:00:00Z", started_at: null, ...over,
  });
  it("keeps a job still inside its timeout", () => {
    const started = new Date(now - jobTimeoutMs("render_itp_pdf", null) + 1000).toISOString();
    expect(isOrphaned(job({ started_at: started }), now)).toBe(false);
    expect(orphanDecision(job({ started_at: started }), now)).toBe("keep");
  });
  it("requeues a stale job while attempts remain and fails it at the cap", () => {
    expect(orphanDecision(job({ attempts: 1 }), now)).toBe("requeue");
    expect(orphanDecision(job({ attempts: MAX_JOB_ATTEMPTS }), now)).toBe("fail");
  });
});
