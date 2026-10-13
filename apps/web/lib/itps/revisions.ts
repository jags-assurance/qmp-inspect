import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { ITP_REVISIONS_TABLE, type ItpRevisionSnapshotSection } from "./revision-types";
import { createNotification } from "@/lib/notifications/helpers";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface SnapshotItemRow {
  id: string;
  item_number: string;
  activity: string;
  acceptance_criteria: string | null;
  evidence_type: number;
  discipline_id: string | null;
  sort_order: number;
  reference_spec: string | null;
  method: string | null;
  frequency: string | null;
  notice_hours_override: number | null;
  governing_drawing_document_id: string | null;
}

interface SnapshotSectionRow {
  id: string;
  section_number: number;
  title: string;
  sort_order: number;
  itp_items: SnapshotItemRow[] | null;
}

async function buildSectionsSnapshot(supabase: SupabaseServerClient, itpId: string): Promise<ItpRevisionSnapshotSection[]> {
  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id, section_number, title, sort_order, itp_items(id, item_number, activity, acceptance_criteria, evidence_type, discipline_id, sort_order, reference_spec, method, frequency, notice_hours_override, governing_drawing_document_id)")
    .eq("itp_id", itpId)
    .order("section_number")
    .returns<SnapshotSectionRow[]>();

  const itemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((i) => i.id));
  const interventionsByItem = new Map<string, { project_party_id: string; party_name: string; intervention: string }[]>();
  if (itemIds.length > 0) {
    const { data: levels } = await supabase
      .from("activity_party_intervention")
      .select("itp_item_id, project_party_id, intervention, project_parties(name)")
      .in("itp_item_id", itemIds)
      .returns<{ itp_item_id: string; project_party_id: string; intervention: string; project_parties: { name: string } | null }[]>();
    for (const row of levels ?? []) {
      const list = interventionsByItem.get(row.itp_item_id) ?? [];
      list.push({ project_party_id: row.project_party_id, party_name: row.project_parties?.name ?? "", intervention: row.intervention });
      interventionsByItem.set(row.itp_item_id, list);
    }
  }

  return (sections ?? []).map((s) => ({
    id: s.id,
    section_number: s.section_number,
    title: s.title,
    sort_order: s.sort_order,
    items: [...(s.itp_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ ...i, interventions: interventionsByItem.get(i.id) ?? [] })),
  }));
}

/**
 * Writes revision 0's baseline snapshot at the moment of initial approval — the first time the
 * document is genuinely "issued" (R101). Called once, right after the draft -> approved status
 * transition succeeds (advanceItpStatusAction); never increments itps.revision itself, since 0 is
 * already the starting value — only a later edit-after-issue bumps it.
 */
export async function snapshotInitialIssue(supabase: SupabaseServerClient, itpId: string, userId: string | null): Promise<void> {
  const { data: itp } = await supabase
    .from("itps")
    .select("id, revision, title, scope, applicable_standard")
    .eq("id", itpId)
    .maybeSingle<{ id: string; revision: number; title: string; scope: string | null; applicable_standard: string | null }>();
  if (!itp) return;

  const sections = await buildSectionsSnapshot(supabase, itpId);
  await supabase.from(ITP_REVISIONS_TABLE).insert({
    itp_id: itpId,
    revision: itp.revision,
    title: itp.title,
    scope: itp.scope,
    applicable_standard: itp.applicable_standard,
    sections_snapshot: sections,
    reason: "Initial issue",
    created_by: userId,
  });
}

/**
 * The actual R101 fix: if this ITP has already been issued (status approved or client_accepted),
 * freezes its CURRENT content as revision N's history row, then increments itps.revision to N+1 —
 * called before applying any content edit reachable after issue (currently only addItpItemAction;
 * see that file's own comment on why no other post-issue edit path exists yet). A no-op (bumped:
 * false, no error) while still draft/under_review, since ordinary pre-issue editing was never the
 * gap R101 describes.
 */
export async function bumpRevisionIfIssued(
  supabase: SupabaseServerClient,
  itpId: string,
  reason: string,
  userId: string | null
): Promise<BumpResult> {
  const { data: itp } = await supabase
    .from("itps")
    .select("id, status, revision, title, scope, applicable_standard, revision_needs_approval, itp_number, project_id")
    .eq("id", itpId)
    .maybeSingle<{
      id: string;
      status: string;
      revision: number;
      title: string;
      scope: string | null;
      applicable_standard: string | null;
      revision_needs_approval: boolean | null;
      itp_number: string;
      project_id: string;
    }>();
  if (!itp) return { bumped: false, error: null };
  if (itp.status !== "approved" && itp.status !== "client_accepted") return { bumped: false, error: null };
  // A revision that is already open for approval absorbs further edits: one revision per approval
  // cycle, not one per click. (The content of the open revision is snapshotted when it is approved.)
  if (itp.revision_needs_approval) return { bumped: false, error: null };

  // itp_revisions is UNIQUE (itp_id, revision), and revision 0's baseline row is already written at
  // initial approval (snapshotInitialIssue). Inserting "the current revision" again on the first
  // post-issue edit therefore violated that constraint and blocked EVERY first edit of an issued
  // ITP. Where the row for the current revision already exists, it IS the frozen content (nothing
  // can change an issued ITP without passing through here), so keep its snapshot and append the
  // reason for moving on instead of inserting a duplicate.
  const { data: existing } = await supabase
    .from(ITP_REVISIONS_TABLE)
    .select("id, reason")
    .eq("itp_id", itpId)
    .eq("revision", itp.revision)
    .maybeSingle<{ id: string; reason: string | null }>();

  let snapshotError: unknown = null;
  if (existing) {
    ({ error: snapshotError } = await supabase
      .from(ITP_REVISIONS_TABLE)
      .update({ reason: `${existing.reason ?? "Issued"} → Rev ${itp.revision + 1}: ${reason}` })
      .eq("id", existing.id));
  } else {
    const sections = await buildSectionsSnapshot(supabase, itpId);
    ({ error: snapshotError } = await supabase.from(ITP_REVISIONS_TABLE).insert({
      itp_id: itpId,
      revision: itp.revision,
      title: itp.title,
      scope: itp.scope,
      applicable_standard: itp.applicable_standard,
      sections_snapshot: sections,
      reason,
      created_by: userId,
    }));
  }
  if (snapshotError) {
    console.error("[itp-revisions] snapshot write failed", itpId, snapshotError);
    return { bumped: false, error: "Could not record revision history. The edit was not applied — try again." };
  }

  // Conditional on the revision still being the one we read and not yet pending, so two concurrent edits
  // can't both bump: the loser sees zero rows updated and simply joins the revision the winner opened.
  const { data: bumpedRows, error: bumpError } = await supabase
    .from("itps")
    .update({ revision: itp.revision + 1, revision_needs_approval: true, revision_changed_by: userId } as never)
    .eq("id", itpId)
    .eq("revision", itp.revision)
    .eq("revision_needs_approval" as never, false as never)
    .select("id");
  if (bumpError) {
    return { bumped: false, error: "Could not increment the ITP revision. The edit was not applied — try again." };
  }
  if (!bumpedRows?.length) return { bumped: false, error: null };

  await notifyRevisionPending(supabase, itp, userId, reason);

  return {
    bumped: true,
    error: null,
    // The caller's edit failed after the bump: put the revision back so no phantom revision is left behind.
    undo: async () => {
      await supabase
        .from("itps")
        .update({ revision: itp.revision, revision_needs_approval: false, revision_changed_by: null } as never)
        .eq("id", itpId)
        .eq("revision", itp.revision + 1);
    },
  };
}

export interface BumpResult {
  bumped: boolean;
  error: string | null;
  undo?: () => Promise<void>;
}

/** Tells the project's responsible person (unless they made the change) that a revision now needs approval. Best-effort. */
async function notifyRevisionPending(
  supabase: SupabaseServerClient,
  itp: { id: string; itp_number: string; project_id: string; revision: number },
  changedBy: string | null,
  reason: string
): Promise<void> {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id, responsible_person_id")
      .eq("id", itp.project_id)
      .maybeSingle<{ organization_id: string; responsible_person_id: string | null }>();
    if (!project?.responsible_person_id || project.responsible_person_id === changedBy) return;
    await createNotification(supabase, {
      organizationId: project.organization_id,
      projectId: itp.project_id,
      recipientUserId: project.responsible_person_id,
      title: `ITP ${itp.itp_number} revision ${itp.revision + 1} needs approval`,
      body: reason.slice(0, 200),
      link: `/inspect/itps/${itp.id}`,
    });
  } catch {
    // Best-effort — never blocks the edit.
  }
}

/**
 * Freezes the content of revision `revision` at the moment it is approved (the controlled copy), unless a
 * history row for that revision already exists. Called by approveItpRevisionAction.
 */
export async function snapshotApprovedRevision(supabase: SupabaseServerClient, itpId: string, userId: string | null): Promise<void> {
  const { data: itp } = await supabase
    .from("itps")
    .select("id, revision, title, scope, applicable_standard")
    .eq("id", itpId)
    .maybeSingle<{ id: string; revision: number; title: string; scope: string | null; applicable_standard: string | null }>();
  if (!itp) return;
  const { data: existing } = await supabase.from(ITP_REVISIONS_TABLE).select("id").eq("itp_id", itpId).eq("revision", itp.revision).maybeSingle<{ id: string }>();
  if (existing) return;
  const sections = await buildSectionsSnapshot(supabase, itpId);
  await supabase.from(ITP_REVISIONS_TABLE).insert({
    itp_id: itpId,
    revision: itp.revision,
    title: itp.title,
    scope: itp.scope,
    applicable_standard: itp.applicable_standard,
    sections_snapshot: sections,
    reason: "Approved revision",
    created_by: userId,
  });
}
