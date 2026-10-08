import type { NcrStatus } from "@/lib/ncrs/types";
import { resolveSiteTimeZone, siteToday } from "@/lib/ncrs/site-date";

/** Overdue = due date strictly before today in the project's timezone (env site zone when unknown), and not closed. */
export function isOverdue(row: { due_date: string | null; status: NcrStatus }, timeZone?: string | null, now: Date = new Date()): boolean {
  if (!row.due_date || row.status === "closed") return false;
  return row.due_date < siteToday(now, resolveSiteTimeZone(timeZone));
}
