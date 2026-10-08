import { describe, expect, it } from "vitest";
import { parseRegisterStats, registerStatsFromRows, registerStatsRpcArgs } from "../register-stats";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("register stats", () => {
  it("parses the SQL function result", () => {
    expect(
      parseRegisterStats({ total: 3, open: 2, closed: 1, overdue: 1, status_counts: { open: 1, closed: 1, in_progress: 1 }, aging: [1, 0, 1, 0] })
    ).toEqual({ total: 3, open: 2, closed: 1, overdue: 1, statusCounts: { open: 1, closed: 1, in_progress: 1 }, aging: [1, 0, 1, 0] });
  });
  it("rejects anything that is not that shape", () => {
    expect(parseRegisterStats(null)).toBeNull();
    expect(parseRegisterStats({ total: "3" })).toBeNull();
  });
  it("computes the same numbers from rows for the fallback", () => {
    const rows = [
      { status: "open", due_date: "2026-01-01", created_at: day(3) },
      { status: "closed", due_date: "2026-01-01", created_at: day(40) },
      { status: "in_progress", due_date: null, created_at: day(20) },
    ];
    expect(registerStatsFromRows(rows, NOW, "2026-10-10")).toEqual({
      total: 3, open: 2, closed: 1, overdue: 1,
      statusCounts: { open: 1, closed: 1, in_progress: 1 },
      aging: [1, 0, 1, 0],
    });
  });
  it("builds RPC arguments with nulls for absent filters", () => {
    expect(registerStatsRpcArgs({ observations: true, todayIso: "2026-10-10", nowMs: NOW })).toMatchObject({
      p_observations: true, p_project_id: null, p_severity: null, p_assignee: null, p_itp_item_ids: null, p_today: "2026-10-10",
    });
    expect(registerStatsRpcArgs({ observations: false, itpItemIds: [], todayIso: "2026-10-10", nowMs: NOW }).p_itp_item_ids).toEqual([]);
  });
});
