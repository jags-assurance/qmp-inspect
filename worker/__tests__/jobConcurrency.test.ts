import { describe, expect, it } from "vitest";
import { admit, canClaim, jobClass, markFinished, markParked, markStarted, newSchedulerState, nextParked, parseConcurrency, MAX_PARKED_JOBS } from "../src/jobs/jobConcurrency";
import { compareToCertified, decideIssuedRender, describeReprintCheck, mayRecordCertifiedHash } from "../src/jobs/dataBookFreeze";

describe("jobClass / parseConcurrency", () => {
  it("classifies heavy and light", () => {
    expect(jobClass("render_data_book_pdf", {})).toBe("heavy");
    expect(jobClass("render_data_book_pdf", { variant: "handover_certificate" })).toBe("light");
    expect(jobClass("generate_monthly_report_pack")).toBe("heavy");
    expect(jobClass("render_itp_pdf")).toBe("light");
  });
  it("clamps WORKER_CONCURRENCY", () => {
    expect(parseConcurrency(undefined)).toBe(2);
    expect(parseConcurrency("9")).toBe(4);
    expect(parseConcurrency("0")).toBe(1);
    expect(parseConcurrency("abc")).toBe(2);
    expect(parseConcurrency("3")).toBe(3);
  });
});

describe("scheduler", () => {
  it("allows one heavy job and a light job alongside, parks a second heavy", () => {
    const s = newSchedulerState(2);
    expect(admit(s, "a", "heavy")).toBe("start");
    markStarted(s, "a", "heavy");
    expect(admit(s, "b", "heavy")).toBe("park");
    markParked(s, "b", "heavy");
    expect(admit(s, "c", "light")).toBe("start");
    markStarted(s, "c", "light");
    expect(canClaim(s)).toBe(false);
    markFinished(s, "c");
    expect(nextParked(s)).toBeNull();
    markFinished(s, "a");
    expect(nextParked(s)?.id).toBe("b");
  });
  it("stops claiming when too many are parked", () => {
    const s = newSchedulerState(4);
    for (let i = 0; i < MAX_PARKED_JOBS; i++) markParked(s, `p${i}`, "heavy");
    expect(canClaim(s)).toBe(false);
  });
});

describe("issued data book freeze", () => {
  it("decides the render action", () => {
    expect(decideIssuedRender({ status: "compiled", force: false, filedPath: null })).toBe("render_normal");
    expect(decideIssuedRender({ status: "issued", force: false, filedPath: null })).toBe("render_first_certified");
    expect(decideIssuedRender({ status: "issued", force: false, filedPath: "x.pdf" })).toBe("return_filed");
    expect(decideIssuedRender({ status: "issued", force: true, filedPath: "x.pdf" })).toBe("reprint");
  });
  it("compares hashes and guards the certified record", () => {
    expect(compareToCertified(null, "a")).toBe("no_certified_hash");
    expect(compareToCertified("AB", "ab")).toBe("match");
    expect(compareToCertified("ab", "cd")).toBe("mismatch");
    expect(mayRecordCertifiedHash(null)).toBe(true);
    expect(mayRecordCertifiedHash("abc")).toBe(false);
  });
  it("flags a content mismatch against the issue snapshot", () => {
    expect(describeReprintCheck({ certifiedSha: "a", reprintSha: "b", snapshotContentHash: "h1", reprintContentHash: "h2" }).mismatch).toBe(true);
    expect(describeReprintCheck({ certifiedSha: "a", reprintSha: "b", snapshotContentHash: "h1", reprintContentHash: "h1" }).mismatch).toBe(false);
  });
});
