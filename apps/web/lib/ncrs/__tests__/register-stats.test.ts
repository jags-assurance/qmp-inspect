import { describe, expect, it } from "vitest";
import { summariseObservationRows } from "../register-stats";

const NOW = Date.parse("2026-11-16T12:00:00Z");

describe("summariseObservationRows", () => {
  it("counts total, open, closed and overdue", () => {
    const s = summariseObservationRows(
      [
        { status: "open", due_date: "2026-11-10", created_at: "2026-11-01T00:00:00Z" },
        { status: "in_progress", due_date: "2026-11-20", created_at: "2026-11-15T12:00:00Z" },
        { status: "closed", due_date: "2026-11-01", created_at: "2026-10-01T00:00:00Z" },
        { status: "open", due_date: null, created_at: "2026-11-16T00:00:00Z" },
      ],
      NOW,
      "2026-11-16"
    );
    expect(s).toMatchObject({ total: 4, open: 3, closed: 1, overdue: 1 });
  });

  it("only reports ages of open rows", () => {
    const s = summariseObservationRows(
      [
        { status: "open", due_date: null, created_at: "2026-11-06T12:00:00Z" },
        { status: "closed", due_date: null, created_at: "2026-01-01T00:00:00Z" },
      ],
      NOW,
      "2026-11-16"
    );
    expect(s.openAgeDays).toEqual([10]);
  });

  it("is all zeros for no rows", () => {
    expect(summariseObservationRows([], NOW, "2026-11-16")).toEqual({ total: 0, open: 0, closed: 0, overdue: 0, openAgeDays: [] });
  });
});
