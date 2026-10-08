import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ResponseHistoryEntry {
  id: string;
  checklist_item_id: string;
  old_result: string | null;
  old_comment: string | null;
  old_numeric_value: string | null;
  changed_at: string;
  changed_by_name: string | null;
}

/** Earlier values of answers changed while the inspection was in progress. Empty until 20261113000800 is applied. */
export async function listResponseHistory(supabase: Client, inspectionRecordId: string): Promise<ResponseHistoryEntry[]> {
  const { data, error } = await supabase
    .from("checklist_response_history" as never)
    .select("id, checklist_item_id, old_result, old_comment, old_numeric_value, changed_at, users:changed_by(full_name)")
    .eq("inspection_record_id" as never, inspectionRecordId as never)
    .order("changed_at" as never, { ascending: false })
    .limit(200)
    .returns<(Omit<ResponseHistoryEntry, "changed_by_name"> & { users: { full_name: string } | null })[]>();
  if (error) return [];
  return (data ?? []).map(({ users, ...rest }) => ({ ...rest, changed_by_name: users?.full_name ?? null }));
}

/** Groups history by item so each item's earlier answers show together, newest first. */
export function groupHistoryByItem(entries: ResponseHistoryEntry[]): Map<string, ResponseHistoryEntry[]> {
  const out = new Map<string, ResponseHistoryEntry[]>();
  for (const e of entries) {
    const list = out.get(e.checklist_item_id);
    if (list) list.push(e);
    else out.set(e.checklist_item_id, [e]);
  }
  return out;
}
