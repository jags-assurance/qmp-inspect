// Shared URL-param filters for the NCR register page and its CSV export.
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

/** Applies the non-search filters to a Supabase ncrs query. `userId` resolves assignee=me. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyNcrFilters(query: any, p: NcrListParams, userId: string): any {
  if (p.status === "active") query = query.neq("status", "closed");
  else if (p.status && ["open", "in_progress", "pending_verification", "closed"].includes(p.status)) query = query.eq("status", p.status);
  if (p.severity === "minor_ncr" || p.severity === "major_ncr") query = query.eq("severity", p.severity);
  if (p.project) query = query.eq("project_id", p.project);
  if (p.assignee === "me") query = query.eq("assigned_to", userId);
  else if (p.assignee === "unassigned") query = query.is("assigned_to", null);
  if (p.overdue === "1") query = query.neq("status", "closed").lt("due_date", new Date().toISOString().slice(0, 10));
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

/** Days until due (negative = overdue), null when closed or no due date. */
export function daysUntilDue(row: { due_date: string | null; status: string }): number | null {
  if (!row.due_date || row.status === "closed") return null;
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return Math.round((new Date(row.due_date).getTime() - today) / 86400000);
}
