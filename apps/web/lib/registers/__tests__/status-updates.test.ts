import { describe, expect, it } from "vitest";
import { groupStatusUpdates } from "../status-updates";

describe("groupStatusUpdates", () => {
  it("returns nothing for no updates", () => {
    expect(groupStatusUpdates([])).toEqual([]);
  });

  it("groups ids by their new status", () => {
    const out = groupStatusUpdates([
      { id: "1", next: "expired" },
      { id: "2", next: "valid" },
      { id: "3", next: "expired" },
    ]);
    expect(out).toEqual([
      { status: "expired", ids: ["1", "3"] },
      { status: "valid", ids: ["2"] },
    ]);
  });

  it("chunks long id lists so the request URL stays short", () => {
    const updates = Array.from({ length: 250 }, (_, i) => ({ id: String(i), next: "expired" }));
    const out = groupStatusUpdates(updates, 100);
    expect(out.map((g) => g.ids.length)).toEqual([100, 100, 50]);
    expect(out.every((g) => g.status === "expired")).toBe(true);
  });
});
