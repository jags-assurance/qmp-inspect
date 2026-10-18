import type { SignoffStatus } from "@/lib/signoff/db-types";

/**
 * Pure summaries for the activity-first ITP workspace. They only re-express the rules the ITP page has always
 * used: one sign-off point per party that has an intervention level on the activity, and an activity counts as
 * fully signed off only when EVERY one of its points is `signed_off` ("proceeded without response" is not a
 * sign-off). A party with no intervention level has no role in the activity: it is never pending.
 */

export type PartyState = "not_required" | "pending" | "notified" | "signed_off" | "proceeded";

export interface WorkspaceCell {
  /** Intervention level code (H/W/R/S or an organisation's own); null = this party has no part in the activity. */
  intervention: string | null;
  /** The tracked sign-off row's status, or null when there is none. */
  status: SignoffStatus | null;
  /** Whether this level is configured as blocking (Hold-equivalent) for the organisation. */
  isBlocking: boolean;
  /** Whether the current user may sign off for this party. */
  canSignOff: boolean;
}

export function partyState(cell: Pick<WorkspaceCell, "intervention" | "status">): PartyState {
  if (!cell.intervention) return "not_required";
  if (cell.status === "signed_off") return "signed_off";
  if (cell.status === "proceeded_no_response") return "proceeded";
  if (cell.status === "notified") return "notified";
  return "pending";
}

export type ActivityStatus = "no_signoffs" | "not_started" | "in_progress" | "signed_off";

export interface ActivitySummary {
  /** Sign-off points that apply (parties with an intervention level). */
  required: number;
  /** Points that are signed off (and only those). */
  done: number;
  pending: number;
  notified: number;
  proceeded: number;
  status: ActivityStatus;
  /** A blocking (Hold-type) point is still open: dependent work must not progress. */
  holdOpen: boolean;
  /** Points the current user can sign off right now (notified, and permitted). */
  yourSignoffs: number;
}

export function summariseActivity(cells: WorkspaceCell[]): ActivitySummary {
  let required = 0;
  let done = 0;
  let pending = 0;
  let notified = 0;
  let proceeded = 0;
  let holdOpen = false;
  let yourSignoffs = 0;
  for (const cell of cells) {
    const state = partyState(cell);
    if (state === "not_required") continue;
    required += 1;
    if (state === "signed_off") done += 1;
    else {
      if (state === "pending") pending += 1;
      if (state === "notified") notified += 1;
      if (state === "proceeded") proceeded += 1;
      if (cell.isBlocking) holdOpen = true;
      if (state === "notified" && cell.canSignOff) yourSignoffs += 1;
    }
  }
  const status: ActivityStatus =
    required === 0 ? "no_signoffs" : done === required ? "signed_off" : done > 0 || notified > 0 || proceeded > 0 ? "in_progress" : "not_started";
  return { required, done, pending, notified, proceeded, status, holdOpen, yourSignoffs };
}

export interface SectionSummary {
  activities: number;
  /** Activities with at least one required sign-off whose points are all signed off. */
  fullySignedOff: number;
  /** Activities that have required sign-offs at all (the denominator the page header uses). */
  withSignoffs: number;
  requiredPoints: number;
  donePoints: number;
  outstandingPoints: number;
}

export function summariseSection(activities: ActivitySummary[]): SectionSummary {
  const withSignoffs = activities.filter((a) => a.required > 0);
  return {
    activities: activities.length,
    fullySignedOff: withSignoffs.filter((a) => a.status === "signed_off").length,
    withSignoffs: withSignoffs.length,
    requiredPoints: activities.reduce((n, a) => n + a.required, 0),
    donePoints: activities.reduce((n, a) => n + a.done, 0),
    outstandingPoints: activities.reduce((n, a) => n + (a.required - a.done), 0),
  };
}

export interface OutstandingItem {
  itemId: string;
  itemNumber: string;
  activity: string;
  summary: ActivitySummary;
  /** Evidence required by the activity's type but none attached yet (documents for type 2, measurements for type 3). */
  evidenceMissing: boolean;
  /** Expected test records not yet received. */
  recordsOutstanding: number;
}

export interface OutstandingActions {
  /** Sign-off points not yet notified (staff still have to press Notify). */
  toNotify: number;
  /** Notified, waiting for the party. */
  awaitingParty: number;
  /** Notified points the current user can sign off. */
  yourSignoffs: number;
  /** Activities whose blocking (Hold) point is still open. */
  holdsOpen: number;
  evidenceMissing: number;
  recordsOutstanding: number;
  /** First few activities to jump to, in the order the page lists them. */
  jumpTargets: { itemId: string; itemNumber: string; activity: string; reason: "hold" | "your_signoff" | "to_notify" | "evidence" }[];
  total: number;
}

export function summariseOutstanding(items: OutstandingItem[], limit = 6): OutstandingActions {
  const out: OutstandingActions = {
    toNotify: 0,
    awaitingParty: 0,
    yourSignoffs: 0,
    holdsOpen: 0,
    evidenceMissing: 0,
    recordsOutstanding: 0,
    jumpTargets: [],
    total: 0,
  };
  for (const item of items) {
    out.toNotify += item.summary.pending;
    out.awaitingParty += item.summary.notified;
    out.yourSignoffs += item.summary.yourSignoffs;
    if (item.summary.holdOpen) out.holdsOpen += 1;
    if (item.evidenceMissing) out.evidenceMissing += 1;
    out.recordsOutstanding += item.recordsOutstanding;
    const reason = item.summary.yourSignoffs > 0 ? "your_signoff" : item.summary.holdOpen ? "hold" : item.summary.pending > 0 ? "to_notify" : item.evidenceMissing ? "evidence" : null;
    if (reason && out.jumpTargets.length < limit) {
      out.jumpTargets.push({ itemId: item.itemId, itemNumber: item.itemNumber, activity: item.activity, reason });
    }
  }
  out.total = out.toNotify + out.awaitingParty + out.evidenceMissing + out.recordsOutstanding;
  return out;
}
