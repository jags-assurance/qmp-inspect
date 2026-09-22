import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { ITP_MASTER_SECTIONS_TABLE } from "@/lib/itp-master/types";
import { ITP_MASTER_REVISIONS_TABLE, type ItpMasterRevisionSnapshotSection } from "./revision-types";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface SnapshotItemRow {
  id: string;
  item_number: string;
  activity: string;
  acceptance_criteria: string | null;
  evidence_type: number;
  discipline_id: string | null;
  sort_order: number;
}

interface SnapshotSectionRow {
  id: string;
  section_number: number;
  title: string;
  sort_order: number;
  itp_master_items: SnapshotItemRow[] | null;
}

async function buildSectionsSnapshot(supabase: SupabaseServerClient, templateId: string): Promise<ItpMasterRevisionSnapshotSection[]> {
  const { data: sections } = await supabase
    .from(ITP_MASTER_SECTIONS_TABLE)
    .select(
      "id, section_number, title, sort_order, itp_master_items(id, item_number, activity, acceptance_criteria, evidence_type, discipline_id, sort_order)"
    )
    .eq("template_id", templateId)
    .order("section_number")
    .returns<SnapshotSectionRow[]>();

  return (sections ?? []).map((s) => ({
    id: s.id,
    section_number: s.section_number,
    title: s.title,
    sort_order: s.sort_order,
    items: [...(s.itp_master_items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}

/**
 * Writes a master template's version 1 baseline snapshot, at the moment a `new_template` proposal
 * is approved and its sections/items have just been inserted (R31 — the master-library equivalent
 * of lib/itps/revisions.ts:snapshotInitialIssue). Called once, right after that insert succeeds in
 * reviewProposalAction; never bumps itp_master_templates.version itself, since 1 is already the
 * starting value set by the table default — only a later update_existing approval bumps it.
 */
export async function snapshotInitialVersion(supabase: SupabaseServerClient, templateId: string, userId: string | null): Promise<void> {
  const { data: template } = await supabase
    .from("itp_master_templates")
    .select("id, version, title, industry, applicable_standard")
    .eq("id", templateId)
    .maybeSingle<{ id: string; version: number; title: string; industry: string; applicable_standard: string | null }>();
  if (!template) return;

  const sections = await buildSectionsSnapshot(supabase, templateId);
  await supabase.from(ITP_MASTER_REVISIONS_TABLE).insert({
    template_id: templateId,
    version: template.version,
    title: template.title,
    industry: template.industry,
    applicable_standard: template.applicable_standard,
    sections_snapshot: sections,
    reason: "Initial creation",
    created_by: userId,
  });
}

/**
 * The actual R31 fix: freezes the master template's CURRENT content (its present version number)
 * as a itp_master_revisions row, before an `update_existing` proposal approval replaces it
 * (delete-then-reinsert, see reviewProposalAction). Caller bumps itp_master_templates.version
 * itself afterward — this function only ever writes the snapshot for the version being superseded,
 * same split of responsibility as lib/itps/revisions.ts:bumpRevisionIfIssued. Must be called BEFORE
 * the sections/items delete, since it reads the live itp_master_sections/itp_master_items tables.
 */
export async function snapshotBeforeUpdate(
  supabase: SupabaseServerClient,
  templateId: string,
  reason: string,
  userId: string | null
): Promise<{ error: string | null }> {
  const { data: template } = await supabase
    .from("itp_master_templates")
    .select("id, version, title, industry, applicable_standard")
    .eq("id", templateId)
    .maybeSingle<{ id: string; version: number; title: string; industry: string; applicable_standard: string | null }>();
  if (!template) return { error: "The target master template no longer exists." };

  const sections = await buildSectionsSnapshot(supabase, templateId);
  const { error } = await supabase.from(ITP_MASTER_REVISIONS_TABLE).insert({
    template_id: templateId,
    version: template.version,
    title: template.title,
    industry: template.industry,
    applicable_standard: template.applicable_standard,
    sections_snapshot: sections,
    reason,
    created_by: userId,
  });
  if (error) {
    return { error: "Could not record master template version history. The update was not applied — try again." };
  }
  return { error: null };
}
