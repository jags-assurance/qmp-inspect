import { describe, it, expect } from "vitest";
import { renderingLabel, jobStatusText, retryAttempt } from "../pdf-job-labels";

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
