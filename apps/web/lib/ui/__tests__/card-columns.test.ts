import { describe, it, expect } from "vitest";
import { cardRowsFor } from "../card-columns";

describe("cardRowsFor", () => {
  it("uses a string header as the label", () => {
    const rows = cardRowsFor([{ key: "a", header: "Status" }]);
    expect(rows.map((r) => r.label)).toEqual(["Status"]);
  });

  it("renders non-string headers full width without a label", () => {
    const rows = cardRowsFor([{ key: "a", header: { not: "a string" } as never }]);
    expect(rows[0].label).toBeNull();
  });

  it("lets cardLabel override, including null for no label", () => {
    const rows = cardRowsFor([
      { key: "a", header: "Action", cardLabel: null },
      { key: "b", header: "Rev.", cardLabel: "Revision" },
    ]);
    expect(rows.map((r) => r.label)).toEqual([null, "Revision"]);
  });

  it("drops cardHidden columns but keeps order", () => {
    const rows = cardRowsFor([
      { key: "a", header: "A" },
      { key: "b", header: "B", cardHidden: true },
      { key: "c", header: "C" },
    ]);
    expect(rows.map((r) => r.col.key)).toEqual(["a", "c"]);
  });
});
