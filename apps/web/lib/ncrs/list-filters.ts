// Shared URL-param filters for the NCR register page and its CSV export.
import { resolveSiteTimeZone, siteToday } from "@/lib/ncrs/site-date";

export interface NcrListParams {
  status?: string;
  severity?: string;
  project?: string;
  assignee?: string;
  overdue?: string;
  sort?: string;
  q?: string;
}

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "due", label: "Due date (soonest)" },
  { value: "severity", label: "Severity (major first)" },
];

/** Applies the non-search filters to a Supabase ncrs query. `userId` resolves assignee=me; `timeZone` (the project's zone, when one project is shown) sets the overdue day. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyNcrFilters(query: any, p: NcrListParams, userId: string, timeZone?: string | null): any {
  if (p.status === "active") query = query.neq("status", "closed");
  else if (p.status && ["open", "in_progress", "pending_verification", "closed"].includes(p.status)) query = query.eq("status", p.status);
  if (p.severity === "minor_ncr" || p.severity === "major_ncr") query = query.eq("severity", p.severity);
  if (p.project) query = query.eq("project_id", p.project);
  if (p.assignee === "me") query = query.eq("assigned_to", userId);
  else if (p.assignee === "unassigned") query = query.is("assigned_to", null);
  if (p.overdue === "1") query = query.neq("status", "closed").lt("due_date", siteToday(new Date(), resolveSiteTimeZone(timeZone)));
  return query;
}

export function applyNcrSort(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  sort: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (sort === "due") return query.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (sort === "severity") return query.order("severity", { ascending: true }).order("created_at", { ascending: false });
  return query.order("created_at", { ascending: false });
}

/** Days until due (negative = overdue), null when closed or no due date. Both sides are compared as
 *  UTC calendar dates (date-only), so the boundary never depends on the local timezone or time of day. */
export function daysUntilDue(
  row: { due_date: string | null; status: string },
  now: Date = new Date()
): number | null {
  if (!row.due_date || row.status === "closed") return null;
  const due = Date.parse(`${row.due_date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((due - today) / 86400000);
}
