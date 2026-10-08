import { describe, expect, it } from "vitest";
import { facetsFromRows, parseAuditFacets } from "../facets";

describe("audit facets", () => {
  it("parses the SQL function result", () => {
    expect(parseAuditFacets({ categories: ["ncr", "itp"], actors: [{ id: "u1", name: "Sam" }, { id: "u2" }, { name: "x" }] })).toEqual({
      categories: ["ncr", "itp"],
      actors: [["u1", "Sam"], ["u2", "Unknown"]],
    });
    expect(parseAuditFacets({ categories: "x" })).toBeNull();
    expect(parseAuditFacets(null)).toBeNull();
  });
  it("de-duplicates sample rows for the fallback", () => {
    const rows = [
      { entity_type: "ncr", actor_id: "u1", actor: { full_name: "Sam" } },
      { entity_type: "itp", actor_id: "u1", actor: { full_name: "Sam" } },
      { entity_type: "ncr", actor_id: null, actor: null },
    ];
    expect(facetsFromRows(rows)).toEqual({ categories: ["itp", "ncr"], actors: [["u1", "Sam"]] });
  });
});
