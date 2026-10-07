// Not a "use server" file. Activities in the same project that can receive a duplicated checklist
// (checklist-type activities with no checklist yet; checklist_templates is one-per-activity).
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_TEMPLATES_TABLE } from "./db-types";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface DuplicateTarget {
  itpItemId: string;
  label: string;
}

export async function loadDuplicateTargets(supabase: Supabase, projectId: string, excludeItpItemId: string): Promise<DuplicateTarget[]> {
  const { data: itps } = await supabase.from("itps").select("id, itp_number").eq("project_id", projectId).returns<{ id: string; itp_number: string }[]>();
  const itpById = new Map((itps ?? []).map((i) => [i.id, i.itp_number]));
  if (itpById.size === 0) return [];
  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id, itp_id")
    .in("itp_id", [...itpById.keys()])
    .returns<{ id: string; itp_id: string }[]>();
  const itpBySection = new Map((sections ?? []).map((s) => [s.id, s.itp_id]));
  if (itpBySection.size === 0) return [];
  const { data: items } = await supabase
    .from("itp_items")
    .select("id, item_number, activity, section_id")
    .in("section_id", [...itpBySection.keys()])
    .eq("evidence_type", 1)
    .limit(500)
    .returns<{ id: string; item_number: string; activity: string; section_id: string }[]>();
  const candidates = (items ?? []).filter((i) => i.id !== excludeItpItemId);
  if (candidates.length === 0) return [];
  const { data: existing } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("itp_item_id")
    .in("itp_item_id", candidates.map((c) => c.id))
    .returns<{ itp_item_id: string }[]>();
  const taken = new Set((existing ?? []).map((e) => e.itp_item_id));
  return candidates
    .filter((c) => !taken.has(c.id))
    .map((c) => ({
      itpItemId: c.id,
      label: `${itpById.get(itpBySection.get(c.section_id) ?? "") ?? "ITP"} · ${c.item_number}. ${c.activity}`,
    }));
}
