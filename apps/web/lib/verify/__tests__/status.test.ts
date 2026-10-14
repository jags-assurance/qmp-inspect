import { describe, expect, it } from "vitest";
import { verifyBanner } from "../status";

describe("verifyBanner", () => {
  it("never calls a rejected certificate genuine", () => {
    expect(verifyBanner({ valid: false, status: "rejected" })).toBe("rejected");
    expect(verifyBanner({ valid: true, status: "rejected" })).toBe("rejected");
  });
  it("maps the other states", () => {
    expect(verifyBanner({ valid: true, status: "issued" })).toBe("genuine");
    expect(verifyBanner({ valid: true, status: "void" })).toBe("void");
    expect(verifyBanner({ valid: true, status: "superseded" })).toBe("superseded");
    expect(verifyBanner({ valid: false })).toBe("not_found");
    expect(verifyBanner(null)).toBe("not_found");
  });
});
