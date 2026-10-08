// Which of the dashboard's shared queries a given login actually renders. The three role dashboards
// (external party, JAGS Inspector, JAGS Admin) share one page; it used to run every query for every
// role and throw the unused results away.

export interface DashboardPlanInput {
  isJagsStaff: boolean;
  /** isAdminStaff(session): a JAGS Admin (null staff_role counts as admin). */
  isAdmin: boolean;
}

export interface DashboardQueryPlan {
  /** Every organisation the login can see: the Admin portfolio, or an external client's own org name. */
  organizations: boolean;
  /** The login's own project_parties links: external parties only (staff dashboards never render them). */
  ownParties: boolean;
  /** Open-NCR head count tile: external parties only (the Admin total comes from the portfolio rows). */
  openNcrCount: boolean;
  /** "NCRs assigned to me": external parties and Inspectors (the Admin dashboard has no such panel). */
  ncrsAssignedToMe: boolean;
}

export function planDashboardQueries({ isJagsStaff, isAdmin }: DashboardPlanInput): DashboardQueryPlan {
  const isExternal = !isJagsStaff;
  const isAdminDashboard = isJagsStaff && isAdmin;
  return {
    organizations: isExternal || isAdminDashboard,
    ownParties: isExternal,
    openNcrCount: isExternal,
    ncrsAssignedToMe: !isAdminDashboard,
  };
}
