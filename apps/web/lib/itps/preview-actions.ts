"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { loadItpChecklistPreview, type ItpChecklistPreviewItem } from "@/lib/checklists/preview";

export interface ItpPreview {
  itpNumber: string;
  title: string;
  status: string;
  projectName: string | null;
  /** The checklist(s) belonging to this ITP (real ones once approved, otherwise what they start from). */
  checklists: ItpChecklistPreviewItem[];
  sections: {
    id: string;
    number: string;
    title: string;
    items: { id: string; number: string; activity: string; acceptanceCriteria: string | null }[];
  }[];
}

/**
 * Read-only ITP content for the dashboard's review panel, so a reviewer sees what they are about to
 * accept without leaving the page. Same RLS-scoped reads as the ITP page itself; accepting still
 * goes through acceptItpAction / the accept_itp RPC, which enforces who may accept.
 */
export async function loadItpPreviewAction(itpId: string): Promise<ItpPreview | null> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("itps")
    .select(
      "itp_number, title, status, projects(name), itp_sections(id, section_number, title, sort_order, itp_items(id, item_number, activity, acceptance_criteria, sort_order))"
    )
    .eq("id", itpId)
    .maybeSingle<{
      itp_number: string;
      title: string;
      status: string;
      projects: { name: string } | null;
      itp_sections:
        | {
            id: string;
            section_number: string;
            title: string;
            sort_order?: number;
            itp_items: { id: string; item_number: string; activity: string; acceptance_criteria: string | null; sort_order: number }[] | null;
          }[]
        | null;
    }>();
  if (!data) return null;
  const checklists = await loadItpChecklistPreview(supabase, itpId);

  return {
    itpNumber: data.itp_number,
    title: data.title,
    status: data.status,
    projectName: data.projects?.name ?? null,
    checklists,
    sections: (data.itp_sections ?? [])
      .slice()
      .sort((a, b) => String(a.section_number).localeCompare(String(b.section_number), undefined, { numeric: true }))
      .map((s) => ({
        id: s.id,
        number: String(s.section_number),
        title: s.title,
        items: (s.itp_items ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((it) => ({
            id: it.id,
            number: String(it.item_number),
            activity: it.activity,
            acceptanceCriteria: it.acceptance_criteria,
          })),
      })),
  };
}
