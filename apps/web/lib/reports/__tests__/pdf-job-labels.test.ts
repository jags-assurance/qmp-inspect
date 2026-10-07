import { describe, it, expect } from "vitest";
import { renderingLabel, jobStatusText, retryAttempt, isPdfStale } from "../pdf-job-labels";

describe("isPdfStale (S6-14)", () => {
  const rendered = "2026-11-08T10:00:00Z";
  it("is stale only when the record changed after the render was queued", () => {
    expect(isPdfStale(rendered, "2026-11-08T10:05:00Z")).toBe(true);
    expect(isPdfStale(rendered, "2026-11-08T09:00:00Z")).toBe(false);
  });
  it("tolerates writes right around queue time", () => {
    expect(isPdfStale(rendered, "2026-11-08T10:00:03Z")).toBe(false);
  });
  it("never flags unknown or invalid times", () => {
    expect(isPdfStale(rendered, null)).toBe(false);
    expect(isPdfStale(undefined, rendered)).toBe(false);
    expect(isPdfStale("nope", rendered)).toBe(false);
  });
});

describe("pdf job labels", () => {
  it("shows Rendering for first attempt", () => {
    expect(renderingLabel({ status: "processing" })).toBe("Rendering…");
  });
  it("shows retry label from attempts or message", () => {
    expect(renderingLabel({ status: "pending", attempts: 1 })).toBe("Retrying (attempt 2 of 3)…");
    expect(retryAttempt({ status: "pending", errorMessage: "Attempt 2 failed, will retry: x" })).toBe(2);
    expect(jobStatusText({ status: "pending", errorMessage: "Attempt 2 failed, will retry: x" })).toBe("Retrying (attempt 3 of 3)…");
  });
  it("shows a clear failure", () => {
    expect(jobStatusText({ status: "failed", errorMessage: "Attempt 2 failed, will retry: boom" })).toContain("PDF generation failed");
    expect(jobStatusText({ status: "pending" })).toBe("Queued…");
  });
});
