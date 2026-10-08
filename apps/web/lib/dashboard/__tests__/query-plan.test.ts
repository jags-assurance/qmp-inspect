import { describe, expect, it } from "vitest";
import { planDashboardQueries } from "../query-plan";

describe("planDashboardQueries", () => {
  it("external party: everything its dashboard shows", () => {
    expect(planDashboardQueries({ isJagsStaff: false, isAdmin: false })).toEqual({
      organizations: true,
      ownParties: true,
      openNcrCount: true,
      ncrsAssignedToMe: true,
    });
  });

  it("inspector: no organisations list, parties or open-NCR tile, but its own assigned NCRs", () => {
    expect(planDashboardQueries({ isJagsStaff: true, isAdmin: false })).toEqual({
      organizations: false,
      ownParties: false,
      openNcrCount: false,
      ncrsAssignedToMe: true,
    });
  });

  it("admin: the portfolio needs organisations, nothing else of the per-person queries", () => {
    expect(planDashboardQueries({ isJagsStaff: true, isAdmin: true })).toEqual({
      organizations: true,
      ownParties: false,
      openNcrCount: false,
      ncrsAssignedToMe: false,
    });
  });
});
