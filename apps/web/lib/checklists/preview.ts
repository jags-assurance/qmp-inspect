import type { SupabaseClient } from "@supabase/supabase-js";

export interface ItpChecklistPreviewItem {
  itemId: string;
  sectionNumber: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  /** True for checklist-type activities (evidence_type = 1) — the only ones that get a checklist. */
  hasChecklist: boolean;
  /** The real, already-generated checklist, if there is one. */
  generated: { id: string; number: string; name: string; lines: { text: string; mandatory: boolean }[] } | null;
  /** What generation would start from when none exists yet: the activity's acceptance criteria
   *  (the same fallback generateChecklistsForItp uses when the AI draft isn't available). */
  previewLines: string[];
}

/**
 * The checklist(s) that belong to an ITP, in ITP order, for showing to the people who must accept
 * or approve it. Checklists are generated from an ITP's activities once it is approved — so before
 * approval there is nothing to look at; this returns what each activity's checklist is built from,
 * and after approval the real checklist items. RLS-scoped through the caller's client.
 */
export async function loadItpChecklistPreview(supabase: SupabaseClient, itpId: string): Promise<ItpChecklistPreviewItem[]> {
  const { data: sections } = await supabase
    .from("itp_sections")
    .select("section_number, itp_items(id, item_number, activity, acceptance_criteria, evidence_type, sort_order)")
    .eq("itp_id", itpId)
    .returns<
      {
        section_number: string | number;
        itp_items: { id: string; item_number: string | number; activity: string; acceptance_criteria: string | null; evidence_type: number | null; sort_order: number }[] | null;
      }[]
    >();

  const items = (sections ?? [])
    .slice()
    .sort((a, b) => String(a.section_number).localeCompare(String(b.section_number), undefined, { numeric: true }))
    .flatMap((s) =>
      (s.itp_items ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((it) => ({ ...it, sectionNumber: String(s.section_number) }))
    );
  if (items.length === 0) return [];

  const { data: templates } = await supabase
    .from("checklist_templates")
    .select("id, itp_item_id, checklist_number, name")
    .in("itp_item_id", items.map((i) => i.id))
    .returns<{ id: string; itp_item_id: string; checklist_number: string; name: string }[]>();

  const templateIds = (templates ?? []).map((t) => t.id);
  const { data: lines } = templateIds.length
    ? await supabase
        .from("checklist_items")
        .select("template_id, description, is_mandatory, sort_order")
        .in("template_id", templateIds)
        .order("sort_order")
        .returns<{ template_id: string; description: string; is_mandatory: boolean; sort_order: number }[]>()
    : { data: [] as { template_id: string; description: string; is_mandatory: boolean; sort_order: number }[] };

  const linesByTemplate = new Map<string, { text: string; mandatory: boolean }[]>();
  for (const l of lines ?? []) {
    const list = linesByTemplate.get(l.template_id) ?? [];
    list.push({ text: l.description, mandatory: l.is_mandatory });
    linesByTemplate.set(l.template_id, list);
  }
  const templateByItem = new Map((templates ?? []).map((t) => [t.itp_item_id, t]));

  return items.map((it) => {
    const hasChecklist = it.evidence_type === 1 || it.evidence_type === null;
    const t = templateByItem.get(it.id);
    return {
      itemId: it.id,
      sectionNumber: it.sectionNumber,
      itemNumber: String(it.item_number),
      activity: it.activity,
      acceptanceCriteria: it.acceptance_criteria,
      hasChecklist,
      generated: t ? { id: t.id, number: t.checklist_number, name: t.name, lines: linesByTemplate.get(t.id) ?? [] } : null,
      previewLines: hasChecklist && !t ? [it.acceptance_criteria?.trim() || it.activity].filter(Boolean) : [],
    };
  });
}
