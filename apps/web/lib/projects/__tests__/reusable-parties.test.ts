import { describe, expect, it } from "vitest";
import { buildReusableParties, type PartyRow } from "../reusable-parties";

const row = (project_id: string, party_type: string, name: string, extra: Partial<PartyRow> = {}): PartyRow => ({
  project_id, party_type, name, contact_name: null, contact_email: null, ...extra,
});

describe("buildReusableParties", () => {
  it("lists parties from other projects once, most-used first", () => {
    const out = buildReusableParties(
      [row("p1", "subcontractor", "Voltway"), row("p2", "subcontractor", "voltway "), row("p2", "tpi_lab", "Bureau Veritas"), row("p3", "subcontractor", "Voltway")],
      "new"
    );
    expect(out.map((p) => [p.name, p.projectCount])).toEqual([["Voltway", 3], ["Bureau Veritas", 1]]);
  });
  it("leaves out a party that is already on this project", () => {
    const out = buildReusableParties([row("new", "subcontractor", "Voltway"), row("p1", "subcontractor", "Voltway"), row("p1", "main_contractor", "GFL")], "new");
    expect(out.map((p) => p.name)).toEqual(["GFL"]);
  });
  it("treats the same name with a different party type as a different party", () => {
    const out = buildReusableParties([row("p1", "subcontractor", "Acme"), row("p1", "vendor", "Acme")], "new");
    expect(out).toHaveLength(2);
  });
  it("keeps the first contact details found (newest row first)", () => {
    const out = buildReusableParties(
      [row("p1", "subcontractor", "Voltway", { contact_name: "Sam", contact_email: "sam@v.test" }), row("p2", "subcontractor", "Voltway", { contact_name: "Old", contact_email: "old@v.test" })],
      "new"
    );
    expect(out[0]).toMatchObject({ contactName: "Sam", contactEmail: "sam@v.test" });
  });
  it("ignores blank names", () => {
    expect(buildReusableParties([row("p1", "vendor", "  ")], "new")).toEqual([]);
  });
});
