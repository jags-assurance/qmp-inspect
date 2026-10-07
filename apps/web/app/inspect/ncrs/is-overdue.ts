import type { NcrStatus } from "@/lib/ncrs/types";
import { siteToday } from "@/lib/ncrs/site-date";

/** Overdue = due date strictly before today in the SITE timezone (not UTC), and not closed. */
export function isOverdue(row: { due_date: string | null; status: NcrStatus }): boolean {
  if (!row.due_date || row.status === "closed") return false;
  return row.due_date < siteToday();
}
