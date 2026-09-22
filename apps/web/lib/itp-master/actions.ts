"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import {
  ITP_MASTER_TEMPLATES_TABLE,
  ITP_MASTER_SECTIONS_TABLE,
  ITP_MASTER_ITEMS_TABLE,
  ITP_MASTER_PROPOSALS_TABLE,
  ITP_MASTER_PROPOSED_ACTIONS,
  type ItpMasterProposedAction,
  type ItpMasterSectionRow,
  type ItpMasterItemRow,
} from "@/lib/itp-master/types";
import { generateChecklistsForItp } from "@/lib/checklists/actions";
import { snapshotInitialVersion, snapshotBeforeUpdate } from "@/lib/itp-master/revisions";
import { recordAuditEvent } from "@/lib/audit/log";

export interface CopyMasterTemplateState {
  error: string | null;
}

/**
 * Starts a new project ITP from a master template: creates a normal `itps` row (status 'draft')
 * plus its sections/items, copied from the chosen master template. No stored link back to the
 * template is kept on the created ITP — per the Tier 1/Tier 2 split, the copy is immediately that
 * project's own independent, editable ITP, so a later master-library change can never leak into it.
 * activity_party_intervention is deliberately untouched here — that's set up per-project afterward
 * on the real ITP, using the existing intervention-grid UI.
 */
export async function copyMasterTemplateToItpAction(
  _prev: CopyMasterTemplateState,
  formData: FormData
): Promise<CopyMasterTemplateState> {
  const masterTemplateId = String(formData.get("master_template_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const itpNumber = String(formData.get("itp_number") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const applicableStandard = String(formData.get("applicable_standard") ?? "").trim();

  if (!masterTemplateId || !projectId || !itpNumber || !title) {
    return { error: "Template, project, ITP number and title are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: masterSections } = await supabase
    .from(ITP_MASTER_SECTIONS_TABLE)
    .select("id, section_number, title, sort_order")
    .eq("template_id", masterTemplateId)
    .order("section_number")
    .returns<ItpMasterSectionRow[]>();

  if (!masterSections || masterSections.length === 0) {
    return { error: "That master template has no sections to copy." };
  }

  const { data: masterItems } = await supabase
    .from(ITP_MASTER_ITEMS_TABLE)
    .select(
      "id, section_id, item_number, activity, reference_spec, acceptance_criteria, method, frequency, evidence_type, discipline_id, sort_order"
    )
    .in(
      "section_id",
      masterSections.map((s) => s.id)
    )
    .returns<ItpMasterItemRow[]>();

  const { data: itp, error } = await supabase
    .from("itps")
    .insert({
      project_id: projectId,
      itp_number: itpNumber,
      title,
      applicable_standard: applicableStandard || null,
      prepared_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !itp) {
    if (error?.code === "23505") {
      return { error: "An ITP with that number already exists for this project." };
    }
    return { error: "Could not create the ITP. Check you have permission and try again." };
  }

  const { data: newSections, error: sectionsError } = await supabase
    .from("itp_sections")
    .insert(
      masterSections.map((s) => ({
        itp_id: itp.id,
        section_number: s.section_number,
        title: s.title,
        sort_order: s.sort_order,
      }))
    )
    .select("id, section_number");

  if (sectionsError || !newSections) {
    return { error: "ITP created, but its sections could not be copied from the template." };
  }

  const sectionIdByNumber = new Map(newSections.map((s) => [s.section_number, s.id]));
  const itemsToInsert = (masterItems ?? []).flatMap((item) => {
    const sourceSection = masterSections.find((s) => s.id === item.section_id);
    const newSectionId = sourceSection ? sectionIdByNumber.get(sourceSection.section_number) : undefined;
    if (!newSectionId) return [];
    return [
      {
        section_id: newSectionId,
        item_number: item.item_number,
        activity: item.activity,
        reference_spec: item.reference_spec,
        acceptance_criteria: item.acceptance_criteria,
        method: item.method,
        frequency: item.frequency,
        evidence_type: item.evidence_type,
        discipline_id: item.discipline_id,
        sort_order: item.sort_order,
      },
    ];
  });

  if (itemsToInsert.length > 0) {
    const { error: itemsError } = await supabase.from("itp_items").insert(itemsToInsert);
    if (itemsError) {
      return { error: "ITP and sections created, but activities could not be copied from the template." };
    }
  }

  // Generate checklists immediately — the master template is already-reviewed, real material (a
  // Tier 1 template promoted through the propose/approve workflow), so this copy is complete and
  // field-usable activities from the moment it's created, same reasoning as the AI-draft path in
  // lib/itps/ai-draft-actions.ts. Best-effort: never blocks the ITP that was just created.
  const { data: projectForChecklists } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();
  if (projectForChecklists) {
    await generateChecklistsForItp(supabase, {
      itpId: itp.id,
      itpNumber,
      projectId,
      organizationId: projectForChecklists.organization_id,
      userId: user?.id ?? null,
    });
    await recordAuditEvent(supabase, {
      organizationId: projectForChecklists.organization_id,
      projectId,
      entityType: "itp",
      entityId: itp.id,
      action: "created_from_master_template",
      actorId: user?.id ?? null,
      summary: `ITP ${itpNumber} created from master template`,
    });
  }

  redirect(`/inspect/itps/${itp.id}`);
}

export interface ProposeToMasterState {
  error: string | null;
  success: boolean;
}

/**
 * Proposes a project's own ITP as a candidate addition/update to the master library. Staff-only
 * (also RLS-enforced on itp_master_proposals, but checked here too for a clean error message
 * instead of a raw RLS denial). Creates nothing in the master tables themselves — that only
 * happens on approval, via reviewProposalAction below.
 */
export async function proposeItpToMasterAction(
  _prev: ProposeToMasterState,
  formData: FormData
): Promise<ProposeToMasterState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can propose an ITP to the master library.", success: false };
  }

  const sourceItpId = String(formData.get("source_itp_id") ?? "").trim();
  const proposedAction = String(formData.get("proposed_action") ?? "").trim() as ItpMasterProposedAction;
  const targetTemplateId = String(formData.get("target_template_id") ?? "").trim();
  const proposedTitle = String(formData.get("proposed_title") ?? "").trim();
  const proposalNotes = String(formData.get("proposal_notes") ?? "").trim();

  if (!sourceItpId || !ITP_MASTER_PROPOSED_ACTIONS.includes(proposedAction)) {
    return { error: "Missing or invalid proposal details.", success: false };
  }
  if (proposedAction === "update_existing" && !targetTemplateId) {
    return { error: "Choose which master template this update applies to.", success: false };
  }

  const supabase = await createSupabaseServerClient();
  const { data: proposal, error } = await supabase
    .from(ITP_MASTER_PROPOSALS_TABLE)
    .insert({
      source_itp_id: sourceItpId,
      proposed_action: proposedAction,
      target_template_id: proposedAction === "update_existing" ? targetTemplateId : null,
      proposed_title: proposedTitle || null,
      proposal_notes: proposalNotes || null,
      proposed_by: session.userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !proposal) {
    return { error: "Could not submit the proposal. Check you have permission and try again.", success: false };
  }

  try {
    const { data: itp } = await supabase
      .from("itps")
      .select("project_id, projects(organization_id)")
      .eq("id", sourceItpId)
      .maybeSingle<{ project_id: string; projects: { organization_id: string } | null }>();
    if (itp?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp_master_proposal",
        entityId: proposal.id,
        action: "proposed",
        actorId: session.userId,
        summary: `ITP proposed to master library (${proposedAction})`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/itps/${sourceItpId}`);
  revalidatePath("/inspect/itp-master/proposals");
  return { error: null, success: true };
}

export interface ReviewProposalState {
  error: string | null;
}

/**
 * Approves or rejects a pending proposal.
 * - Reject: just stamps status/reviewed_by/reviewed_at/review_notes.
 * - Approve + new_template: creates a new itp_master_templates row (title falls back to the source
 *   ITP's title; industry/discipline are deliberately left for the admin to fill in afterward — the
 *   source ITP has no industry/discipline column to copy them from) plus its sections/items, copied
 *   from the source ITP's current itp_sections/itp_items. Stamps target_template_id on the proposal
 *   for traceability.
 * - Approve + update_existing: bumps the target template's version by 1 and REPLACES its
 *   sections/items with the source ITP's current ones (delete-then-reinsert, not a surgical diff —
 *   simplest correct option for this phase). The pre-update content is frozen into
 *   itp_master_revisions before the delete (R31 — see lib/itp-master/revisions.ts), so prior
 *   versions stay browsable even though the live tables only ever hold the current one.
 */
export async function reviewProposalAction(
  _prev: ReviewProposalState,
  formData: FormData
): Promise<ReviewProposalState> {
  const session = await requireSession();
  // Reviewing (approving/rejecting) is the Admin's call — an Inspector can propose an ITP to the
  // library (see proposeItpToMasterAction above) but not decide what actually enters it.
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can review master library proposals." };
  }

  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const reviewNotes = String(formData.get("review_notes") ?? "").trim();

  if (!proposalId || (decision !== "approve" && decision !== "reject")) {
    return { error: "Missing or invalid review decision." };
  }
  if (decision === "reject" && !reviewNotes) {
    return { error: "Review notes are required when rejecting a proposal." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: proposal } = await supabase
    .from(ITP_MASTER_PROPOSALS_TABLE)
    .select("id, source_itp_id, proposed_action, target_template_id, proposed_title, status")
    .eq("id", proposalId)
    .maybeSingle<{
      id: string;
      source_itp_id: string;
      proposed_action: ItpMasterProposedAction;
      target_template_id: string | null;
      proposed_title: string | null;
      status: string;
    }>();

  if (!proposal) {
    return { error: "Proposal not found." };
  }
  if (proposal.status !== "pending") {
    return { error: "This proposal has already been reviewed." };
  }

  if (decision === "reject") {
    await supabase
      .from(ITP_MASTER_PROPOSALS_TABLE)
      .update({
        status: "rejected",
        reviewed_by: session.userId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes || null,
      })
      .eq("id", proposalId);

    try {
      const { data: itp } = await supabase
        .from("itps")
        .select("project_id, projects(organization_id)")
        .eq("id", proposal.source_itp_id)
        .maybeSingle<{ project_id: string; projects: { organization_id: string } | null }>();
      if (itp?.projects?.organization_id) {
        await recordAuditEvent(supabase, {
          organizationId: itp.projects.organization_id,
          projectId: itp.project_id,
          entityType: "itp_master_proposal",
          entityId: proposalId,
          action: "rejected",
          actorId: session.userId,
          summary: `Master library proposal rejected: ${reviewNotes}`,
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }

    revalidatePath("/inspect/itp-master/proposals");
    return { error: null };
  }

  // Approve: pull the source ITP's current sections/items to copy into the master library.
  interface SourceSection {
    id: string;
    section_number: number;
    title: string;
    sort_order: number;
  }
  interface SourceItem {
    id: string;
    section_id: string;
    item_number: string;
    activity: string;
    reference_spec: string | null;
    acceptance_criteria: string | null;
    method: string | null;
    frequency: string | null;
    evidence_type: 1 | 2 | 3;
    discipline_id: string | null;
    sort_order: number;
  }

  const { data: sourceItp } = await supabase
    .from("itps")
    .select("id, title")
    .eq("id", proposal.source_itp_id)
    .maybeSingle<{ id: string; title: string }>();

  const { data: sourceSections } = await supabase
    .from("itp_sections")
    .select("id, section_number, title, sort_order")
    .eq("itp_id", proposal.source_itp_id)
    .order("section_number")
    .returns<SourceSection[]>();

  if (!sourceItp || !sourceSections || sourceSections.length === 0) {
    return { error: "The source ITP has no sections to copy into the master library." };
  }

  const { data: sourceItems } = await supabase
    .from("itp_items")
    .select(
      "id, section_id, item_number, activity, reference_spec, acceptance_criteria, method, frequency, evidence_type, discipline_id, sort_order"
    )
    .in(
      "section_id",
      sourceSections.map((s) => s.id)
    )
    .returns<SourceItem[]>();

  let targetTemplateId = proposal.target_template_id;
  let bumpedVersion: number | null = null;

  if (proposal.proposed_action === "new_template") {
    const { data: newTemplate, error: templateError } = await supabase
      .from(ITP_MASTER_TEMPLATES_TABLE)
      .insert({
        title: proposal.proposed_title || sourceItp.title,
        // Industry/discipline are left null here on purpose (see doc comment above) — an admin
        // fills them in via a follow-up edit; there's nothing on `itps` to copy them from.
        industry: "",
        created_by: session.userId,
      })
      .select("id")
      .single<{ id: string }>();

    if (templateError || !newTemplate) {
      return { error: "Could not create the new master template." };
    }
    targetTemplateId = newTemplate.id;
  } else {
    if (!targetTemplateId) {
      return { error: "No target template was set on this proposal." };
    }

    const { data: existingTemplate } = await supabase
      .from(ITP_MASTER_TEMPLATES_TABLE)
      .select("version")
      .eq("id", targetTemplateId)
      .maybeSingle<{ version: number }>();

    if (!existingTemplate) {
      return { error: "The target master template no longer exists." };
    }
    bumpedVersion = existingTemplate.version + 1;

    // R31: freeze the template's current (pre-update) content as a itp_master_revisions row before
    // it's replaced below — must run before the delete, since it reads the live
    // itp_master_sections/itp_master_items tables. See lib/itp-master/revisions.ts.
    const { error: snapshotError } = await snapshotBeforeUpdate(
      supabase,
      targetTemplateId,
      reviewNotes || "Updated from proposal",
      session.userId
    );
    if (snapshotError) {
      return { error: snapshotError };
    }

    // Replace (delete-then-reinsert) rather than a surgical diff — simplest correct option for
    // this phase; cascades to itp_master_items via the FK's `on delete cascade`.
    await supabase.from(ITP_MASTER_SECTIONS_TABLE).delete().eq("template_id", targetTemplateId);
  }

  const { data: newMasterSections, error: masterSectionsError } = await supabase
    .from(ITP_MASTER_SECTIONS_TABLE)
    .insert(
      sourceSections.map((s) => ({
        template_id: targetTemplateId,
        section_number: s.section_number,
        title: s.title,
        sort_order: s.sort_order,
      }))
    )
    .select("id, section_number")
    .returns<{ id: string; section_number: number }[]>();

  if (masterSectionsError || !newMasterSections) {
    return { error: "Could not copy the source ITP's sections into the master library." };
  }

  const sectionIdByNumber = new Map(newMasterSections.map((s) => [s.section_number, s.id]));
  const masterItemsToInsert = (sourceItems ?? []).flatMap((item) => {
    const sourceSection = sourceSections.find((s) => s.id === item.section_id);
    const newSectionId = sourceSection ? sectionIdByNumber.get(sourceSection.section_number) : undefined;
    if (!newSectionId) return [];
    return [
      {
        section_id: newSectionId,
        item_number: item.item_number,
        activity: item.activity,
        reference_spec: item.reference_spec,
        acceptance_criteria: item.acceptance_criteria,
        method: item.method,
        frequency: item.frequency,
        evidence_type: item.evidence_type,
        discipline_id: item.discipline_id,
        sort_order: item.sort_order,
      },
    ];
  });

  if (masterItemsToInsert.length > 0) {
    const { error: masterItemsError } = await supabase.from(ITP_MASTER_ITEMS_TABLE).insert(masterItemsToInsert);
    if (masterItemsError) {
      return { error: "Sections copied, but activities could not be copied into the master library." };
    }
  }

  if (proposal.proposed_action === "new_template" && targetTemplateId) {
    // R31: version 1's baseline snapshot, now that the new template's sections/items exist to
    // capture. See lib/itp-master/revisions.ts.
    await snapshotInitialVersion(supabase, targetTemplateId, session.userId);
  }

  if (bumpedVersion !== null) {
    await supabase
      .from(ITP_MASTER_TEMPLATES_TABLE)
      .update({ version: bumpedVersion })
      .eq("id", targetTemplateId);
  }

  await supabase
    .from(ITP_MASTER_PROPOSALS_TABLE)
    .update({
      status: "approved",
      target_template_id: targetTemplateId,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes || null,
    })
    .eq("id", proposalId);

  try {
    const { data: itp } = await supabase
      .from("itps")
      .select("project_id, projects(organization_id)")
      .eq("id", proposal.source_itp_id)
      .maybeSingle<{ project_id: string; projects: { organization_id: string } | null }>();
    if (itp?.projects?.organization_id && targetTemplateId) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp_master_template",
        entityId: targetTemplateId,
        action: "approved_from_proposal",
        actorId: session.userId,
        summary: `Master library proposal approved (${proposal.proposed_action})`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath("/inspect/itp-master");
  revalidatePath("/inspect/itp-master/proposals");
  return { error: null };
}
