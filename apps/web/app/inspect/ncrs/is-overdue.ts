import type { NcrStatus } from "@/lib/ncrs/types";

export function isOverdue(row: { due_date: string | null; status: NcrStatus }): boolean {
  if (!row.due_date || row.status === "closed") return false;
  return row.due_date < new Date().toISOString().slice(0, 10);
}
