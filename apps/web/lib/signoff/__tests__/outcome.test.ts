import { describe, expect, it } from "vitest";
import { canRejectFromStatus, normaliseSignoffComment, validateRejectionReason } from "../outcome";

describe("normaliseSignoffComment", () => {
  it("blank is null", () => {
    expect(normaliseSignoffComment("  ")).toEqual({ value: null });
    expect(normaliseSignoffComment(undefined)).toEqual({ value: null });
  });
  it("trims and caps", () => {
    expect(normaliseSignoffComment(" ok ")).toEqual({ value: "ok" });
    expect("error" in normaliseSignoffComment("x".repeat(1001))).toBe(true);
  });
});

describe("validateRejectionReason", () => {
  it("requires a real reason", () => {
    expect("error" in validateRejectionReason("short")).toBe(true);
    expect(validateRejectionReason("Weld not accessible for NDT")).toEqual({ value: "Weld not accessible for NDT" });
  });
});

describe("canRejectFromStatus", () => {
  it("only unreleased rows", () => {
    expect(canRejectFromStatus("pending")).toBe(true);
    expect(canRejectFromStatus("notified")).toBe(true);
    expect(canRejectFromStatus("signed_off")).toBe(false);
    expect(canRejectFromStatus("proceeded_no_response")).toBe(false);
  });
});
