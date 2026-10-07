import { describe, expect, it } from "vitest";
import { pickExpiringItems } from "../expiring";

const today = new Date("2026-11-07T00:00:00Z");
const row = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "calibration" as const,
  projectId: "p",
  label: `L-${id}`,
  date,
  ...over,
});

describe("pickExpiringItems", () => {
  it("keeps lapsed and soon-lapsing rows, soonest first, and drops far-future ones", () => {
    const r = pickExpiringItems([row("a", "2026-12-01"), row("b", "2026-11-01"), row("c", "2027-06-01"), row("d", "2026-11-10")], 30, 10, today);
    expect(r.items.map((i) => i.id)).toEqual(["b", "d", "a"]);
    expect(r.items[0].days).toBe(-6);
    expect(r.total).toBe(3);
  });
  it("ignores retired / superseded rows", () => {
    const r = pickExpiringItems([row("a", "2026-11-01", { lifecycle_status: "retired" }), row("b", "2026-11-02")], 30, 10, today);
    expect(r.items.map((i) => i.id)).toEqual(["b"]);
  });
  it("caps the list but reports the true total", () => {
    const rows = ["a", "b", "c", "d"].map((id, i) => row(id, `2026-11-0${i + 1}`));
    const r = pickExpiringItems(rows, 30, 2, today);
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(4);
  });
});
