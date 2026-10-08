import { describe, expect, it } from "vitest";
import { remainingUnnotified, validateWaiverReason, WAIVER_REASON_MAX } from "../notice-waiver";

describe("validateWaiverReason", () => {
  it("needs a real written reason", () => {
    expect(validateWaiverReason("   too short ")).toHaveProperty("error");
    expect(validateWaiverReason("Client agreed by phone, see email")).toEqual({ reason: "Client agreed by phone, see email" });
  });
  it("caps the length", () => {
    expect(validateWaiverReason("x".repeat(WAIVER_REASON_MAX + 1))).toHaveProperty("error");
  });
});

describe("remainingUnnotified", () => {
  it("drops waived codes and keeps the rest", () => {
    expect(remainingUnnotified(["W", "R"], ["W"])).toEqual(["R"]);
    expect(remainingUnnotified(["W"], [])).toEqual(["W"]);
    expect(remainingUnnotified([], ["W"])).toEqual([]);
  });
});
