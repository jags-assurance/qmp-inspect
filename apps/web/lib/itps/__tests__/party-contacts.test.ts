import { describe, it, expect } from "vitest";
import { partyContactNames, partyWithPeople } from "../party-contacts";

describe("partyContactNames", () => {
  it("orders contact, login, members and removes blanks and duplicates", () => {
    expect(
      partyContactNames({ contactName: " Ann ", linkedUserName: "ann", memberNames: ["Bob", null, "", "Cy"] })
    ).toEqual(["Ann", "Bob", "Cy"]);
  });
  it("returns empty when nothing is known", () => {
    expect(partyContactNames({})).toEqual([]);
  });
});

describe("partyWithPeople", () => {
  it("falls back to the party name", () => {
    expect(partyWithPeople("Acme", [])).toBe("Acme");
  });
  it("lists names and collapses long lists", () => {
    expect(partyWithPeople("Acme", ["A", "B"])).toBe("Acme (A, B)");
    expect(partyWithPeople("Acme", ["A", "B", "C", "D", "E"])).toBe("Acme (A, B, C +2)");
  });
});
