import { describe, expect, it } from "vitest";
import { displayItemNumber } from "../item-number";

describe("displayItemNumber", () => {
  it("does not double an already-qualified number", () => {
    expect(displayItemNumber(1, "1.2")).toBe("1.2");
    expect(displayItemNumber("2", "2.3")).toBe("2.3");
  });
  it("qualifies a bare in-section number", () => {
    expect(displayItemNumber(1, "2")).toBe("1.2");
    expect(displayItemNumber(3, 4)).toBe("3.4");
  });
  it("does not mistake a different section's prefix for its own", () => {
    expect(displayItemNumber(1, "11.2")).toBe("1.11.2");
  });
});
