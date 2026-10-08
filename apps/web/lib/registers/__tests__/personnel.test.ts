import { describe, expect, it } from "vitest";
import { groupCertificatesByPerson } from "../personnel";
import { certificateChange } from "../certificate-history";

const today = new Date("2026-11-07T00:00:00Z");
const row = (id: string, expiry: string, over: Record<string, unknown> = {}) => ({
  id,
  expiry_date: expiry,
  project_party_id: "pp1",
  project_parties: { name: "Acme Welding" },
  ...over,
});

describe("groupCertificatesByPerson", () => {
  it("groups by named holder, falling back to the party", () => {
    const names = new Map([["u1", "Sam Welder"]]);
    const out = groupCertificatesByPerson(
      [row("a", "2026-11-01", { holder_user_id: "u1" }), row("b", "2027-12-01", { holder_user_id: "u1" }), row("c", "2026-11-20")],
      names,
      today
    );
    expect(out).toHaveLength(2);
    const sam = out.find((p) => p.name === "Sam Welder")!;
    expect(sam).toMatchObject({ total: 2, expired: 1, valid: 1, expiringSoon: 0, nextExpiry: "2027-12-01" });
    const party = out.find((p) => p.name === "Acme Welding")!;
    expect(party).toMatchObject({ total: 1, expiringSoon: 1 });
  });
  it("ignores retired rows and sorts the most urgent person first", () => {
    const out = groupCertificatesByPerson(
      [row("a", "2026-01-01", { holder_user_id: "u2" }), row("b", "2026-01-01", { holder_user_id: "u3", lifecycle_status: "retired" }), row("c", "2028-01-01")],
      new Map([["u2", "Zed"]]),
      today
    );
    expect(out.map((p) => p.name)).toEqual(["Zed", "Acme Welding"]);
  });
});

describe("certificateChange", () => {
  it("classifies attach / replace / none", () => {
    expect(certificateChange(null, "p/registers/x/a.pdf")).toBe("attached");
    expect(certificateChange("old", "new")).toBe("replaced");
    expect(certificateChange("old", "old")).toBe("none");
    expect(certificateChange("old", null)).toBe("none");
    expect(certificateChange(undefined, undefined)).toBe("none");
  });
});
