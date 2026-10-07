import { describe, expect, it } from "vitest";
import { extractScanCode } from "../code";

describe("extractScanCode", () => {
  it("returns plain tags unchanged", () => {
    expect(extractScanCode("CAL-2291")).toBe("CAL-2291");
    expect(extractScanCode("  CAL-2291 \n")).toBe("CAL-2291");
  });
  it("reads the code from this app's deep link", () => {
    expect(extractScanCode("https://app.example.com/inspect/start-work/find?code=CL-0042")).toBe("CL-0042");
  });
  it("falls back to the last path segment", () => {
    expect(extractScanCode("https://example.com/assets/PUMP%20P-101")).toBe("PUMP P-101");
  });
  it("takes the first line of multi-line payloads and strips control characters", () => {
    expect(extractScanCode("HEAT-77\nsecond line")).toBe("HEAT-77");
    expect(extractScanCode("AB\u0000CD")).toBe("AB CD");
  });
  it("handles empty and oversized input", () => {
    expect(extractScanCode("")).toBe("");
    expect(extractScanCode(null)).toBe("");
    expect(extractScanCode("x".repeat(500)).length).toBe(80);
  });
});
