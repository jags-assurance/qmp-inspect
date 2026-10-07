import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Why an activity can't be deleted (it has real execution history), or null if it can. */
export async function itemDeleteBlocker(supabase: SupabaseServerClient, itemId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = async (table: string, build: (q: any) => any) => {
    const { count: c } = await build(supabase.from(table as never).select("id", { count: "exact", head: true }));
    return c ?? 0;
  };
  if (await count("inspection_records", (q) => q.eq("itp_item_id", itemId))) {
    return "This activity has inspection records, so it can't be deleted. Its history must be kept.";
  }
  if (await count("activity_signoff_progress", (q) => q.eq("itp_item_id", itemId).in("status", ["signed_off", "proceeded_no_response"]))) {
    return "This activity has signed-off Hold/Witness/Review points, so it can't be deleted. Its history must be kept.";
  }
  if (await count("ncrs", (q) => q.eq("itp_item_id", itemId))) {
    return "An NCR refers to this activity, so it can't be deleted.";
  }
  if (await count("punch_list_items", (q) => q.eq("source_itp_item_id", itemId))) {
    return "A punch-list item refers to this activity, so it can't be deleted.";
  }
  if (await count("itp_item_evidence_documents", (q) => q.eq("itp_item_id", itemId))) {
    return "Evidence documents are linked to this activity — unlink them first.";
  }
  if (await count("itp_item_measurements", (q) => q.eq("itp_item_id", itemId).not("actual_value", "is", null))) {
    return "Measurements have been recorded for this activity, so it can't be deleted.";
  }
  return null;
}

/** Why a section can't be deleted: the first blocker among its activities, or null. */
export async function sectionDeleteBlocker(supabase: SupabaseServerClient, sectionId: string): Promise<string | null> {
  const { data: items, error } = await supabase.from("itp_items").select("id, item_number").eq("section_id", sectionId);
  if (error) return "Could not check the section's activities. Try again.";
  for (const item of items ?? []) {
    const blocker = await itemDeleteBlocker(supabase, item.id);
    if (blocker) return `Activity ${item.item_number}: ${blocker}`;
  }
  return null;
}

/** Resolves a section's real ITP (never trust the posted itp_id). */
export async function resolveSectionItp(
  supabase: SupabaseServerClient,
  sectionId: string
): Promise<{ sectionId: string; itpId: string; status: string; projectId: string } | null> {
  const { data } = await supabase
    .from("itp_sections")
    .select("id, itp_id, itps(status, project_id)")
    .eq("id", sectionId)
    .maybeSingle<{ id: string; itp_id: string; itps: { status: string; project_id: string } | null }>();
  if (!data?.itps) return null;
  return { sectionId: data.id, itpId: data.itp_id, status: data.itps.status, projectId: data.itps.project_id };
}
