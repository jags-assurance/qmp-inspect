/**
 * Per-role dashboard layout. Every role sees the same RLS-scoped data; what differs is WHICH
 * widgets lead and in what order, so each person's first screen is the thing they act on daily
 * (a client accepts ITPs, a main contractor reviews subcontractor work, a subcontractor signs off
 * its own points, an org admin watches the health of their own organisation) with reference
 * material (stat counts, project links) below. Widgets with nothing to show render nothing.
 */

export type DashboardRole = "client" | "client_org_admin" | "main_contractor" | "subcontractor" | "tpi" | "other";

export type ExternalWidget = "orgHealth" | "acceptance" | "review" | "signoffs" | "ncrs" | "stats" | "projects";

const ALL_WIDGETS: ExternalWidget[] = ["orgHealth", "acceptance", "review", "signoffs", "ncrs", "stats", "projects"];

/** A role's lead widgets first; any widget the role's list omits still renders (just after them) so
 *  the "Needs your attention" count can never include something the page hides. */
export function widgetOrderFor(role: DashboardRole): ExternalWidget[] {
  const lead = EXTERNAL_WIDGET_ORDER[role];
  const leadBeforeReference = lead.filter((w) => w !== "stats" && w !== "projects");
  const rest = ALL_WIDGETS.filter((w) => !lead.includes(w) && w !== "orgHealth");
  return [...leadBeforeReference, ...rest, "stats", "projects"];
}

export const EXTERNAL_WIDGET_ORDER: Record<DashboardRole, ExternalWidget[]> = {
  client: ["acceptance", "ncrs", "stats", "projects"],
  client_org_admin: ["orgHealth", "acceptance", "ncrs", "stats", "projects"],
  main_contractor: ["review", "signoffs", "ncrs", "stats", "projects"],
  subcontractor: ["signoffs", "ncrs", "stats", "projects"],
  tpi: ["signoffs", "ncrs", "stats", "projects"],
  other: ["signoffs", "ncrs", "acceptance", "review", "stats", "projects"],
};

/**
 * `partyType` is the viewer's own project_parties.party_type. `managesOwnOrg` is true when their
 * organisation is self-managed / client-managed (they run their own org's settings) — that makes a
 * client login a "client org admin" with the organisation-health widget on top.
 */
export function resolveDashboardRole(partyType: string | null, managesOwnOrg: boolean): DashboardRole {
  if (managesOwnOrg) return "client_org_admin";
  switch (partyType) {
    case "client":
      return "client";
    case "main_contractor":
      return "main_contractor";
    case "subcontractor":
      return "subcontractor";
    case "tpi_lab":
      return "tpi";
    default:
      return "other";
  }
}

export interface OrgHealth {
  /** Active parties on the org's projects, and how many of those have a login linked. */
  activeParties: number;
  partiesWithLogin: number;
  openPunchItems: number;
  overdueNcrs: number;
}
