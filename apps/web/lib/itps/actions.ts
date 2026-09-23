"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { bumpRevisionIfIssued, snapshotInitialIssue } from "@/lib/itps/revisions";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE, type ItpApprovalWorkflowConfigRow } from "@/lib/itp-approval-workflow/types";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage } from "@/lib/ai/log";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS } from "@/lib/ai/gemini-provider";

// Default section structure from the Requirements doc (R24 examples) — a starting point the user
// can add to, rename, or reorder; sections are explicitly not fixed.
const DEFAULT_SECTIONS = [
  { section_number: 1, title: "Submittals & Materials" },
  { section_number: 2, title: "Installation / Execution" },
  { section_number: 3, title: "Testing & Commissioning" },
  { section_number: 4, title: "Handover" },
];

export interface CreateItpState {
  error: string | null;
}

export async function createItpAction(_prev: CreateItpState, formData: FormData): Promise<CreateItpState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const itpNumberOverride = String(formData.get("itp_number") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const applicableStandard = String(formData.get("applicable_standard") ?? "").trim();

  if (!projectId || !title) {
    return { error: "Project and title are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found." };
  }

  // Auto-generated via the same numbering engine every other document type uses (client's own
  // numbering format if configured, else a sensible default) — a manual override is still accepted
  // for the rare case a specific number needs to be forced (e.g. matching a legacy/external scheme).
  const itpNumber =
    itpNumberOverride ||
    (
      await generateDocumentNumber(supabase, {
        organizationId: project.organization_id,
        projectId,
        docType: "itp",
        projectNumber: project.project_number,
      })
    ).documentNumber;

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

  const { error: sectionsError } = await supabase
    .from("itp_sections")
    .insert(DEFAULT_SECTIONS.map((s, i) => ({ itp_id: itp.id, sort_order: i, ...s })));

  if (sectionsError) {
    return { error: "ITP created, but default sections could not be added." };
  }

  // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
  // creation above — see lib/audit/log.ts's doc comment.
  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "itp",
    entityId: itp.id,
    action: "created",
    actorId: user?.id ?? null,
    summary: `ITP ${itpNumber} created`,
  });

  redirect(`/inspect/itps/${itp.id}`);
}

export interface AddItemState {
  error: string | null;
}

export async function addItpItemAction(_prev: AddItemState, formData: FormData): Promise<AddItemState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const itemNumber = String(formData.get("item_number") ?? "").trim();
  const activity = String(formData.get("activity") ?? "").trim();
  const acceptanceCriteria = String(formData.get("acceptance_criteria") ?? "").trim();
  const evidenceType = Number(formData.get("evidence_type") ?? 1);
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();
  const governingDrawingDocumentId = String(formData.get("governing_drawing_document_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  // R25: optional per-activity override of the notice-period hours otherwise resolved from the
  // project/org/built-in fallback chain — see getNoticePeriodHours in lib/signoff/actions.ts. Blank
  // (the common case) leaves it unset so that existing resolution is unaffected.
  const noticeHoursOverrideRaw = String(formData.get("notice_hours_override") ?? "").trim();
  let noticeHoursOverride: number | null = null;
  if (noticeHoursOverrideRaw) {
    const parsed = Number.parseInt(noticeHoursOverrideRaw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return { error: "Notice hours override must be a non-negative whole number, or left blank." };
    }
    noticeHoursOverride = parsed;
  }

  if (!sectionId || !itemNumber || !activity) {
    return { error: "Item number and activity are required." };
  }

  const supabase = await createSupabaseServerClient();

  // R101: itp_items_write RLS lets JAGS staff add an item to an ITP at any status (a client's own
  // is_client_itp_creator path is draft-only, so this is the only edit reachable after issue). Adding
  // an item to an already-approved/client-accepted ITP is exactly the "edit after issue" this
  // requirement targets — freeze the pre-edit content as history and bump the revision counter before
  // applying it, rather than letting an issued document change silently with no record.
  const { data: itpForRevisionCheck } = await supabase
    .from("itps")
    .select("status")
    .eq("id", itpId)
    .maybeSingle<{ status: string }>();
  const isIssued = itpForRevisionCheck?.status === "approved" || itpForRevisionCheck?.status === "client_accepted";

  if (isIssued) {
    if (!revisionReason) {
      return { error: "This ITP has already been issued — a reason is required to add an activity and create a new revision." };
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: revisionError } = await bumpRevisionIfIssued(
      supabase,
      itpId,
      `Added activity ${itemNumber}: ${activity} — ${revisionReason}`,
      user?.id ?? null
    );
    if (revisionError) return { error: revisionError };
  }

  // itp_items.sort_order defaults to 0 in the schema, and this was the only item-creation path that
  // never set it (the AI-draft and master-template-clone paths both assign sort_order: i on insert —
  // see ai-draft-actions.ts and itp-master/actions.ts). Every manually-added item was landing at 0,
  // so once a section had more than one, display order fell back to whatever order Postgrest's
  // embedded-resource query happened to return — not necessarily the item_number sequence the
  // inspector actually typed. Appending after the current highest sort_order in this section keeps
  // manually-added items in the order they were added, matching the other two creation paths.
  const { data: lastItem } = await supabase
    .from("itp_items")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (lastItem?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("itp_items").insert({
    section_id: sectionId,
    item_number: itemNumber,
    activity,
    acceptance_criteria: acceptanceCriteria || null,
    evidence_type: evidenceType === 2 || evidenceType === 3 ? evidenceType : 1,
    discipline_id: disciplineId || null,
    // R103: optional link to the vault "Drawings" document that governs this activity — frozen
    // onto inspection_records at inspection start (see startInspectionAction). Not enforced to
    // actually be in the drawings folder here; the picker only offers those (add-item-form.tsx).
    governing_drawing_document_id: governingDrawingDocumentId || null,
    notice_hours_override: noticeHoursOverride,
    sort_order: nextSortOrder,
  });

  if (error) {
    return { error: "Could not add the activity. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export async function setInterventionAction(formData: FormData) {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const intervention = String(formData.get("intervention") ?? "").trim();

  const supabase = await createSupabaseServerClient();

  if (!intervention) {
    await supabase
      .from("activity_party_intervention")
      .delete()
      .eq("itp_item_id", itpItemId)
      .eq("project_party_id", projectPartyId);
  } else {
    // Look up the label for the notification below (and, incidentally, resolve the organisation so
    // we know which org's levels to check against) before writing the row — the DB itself is the
    // real source of truth for "is this a valid code" (validate_activity_intervention_code trigger,
    // supabase/migrations/20260917090000_configurable_intervention_levels.sql), this is just so the
    // notification reads e.g. "Client QA Review" for a custom level instead of a bare code.
    const { data: context } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(itp_number, project_id, projects(organization_id)))")
      .eq("id", itpItemId)
      .maybeSingle<{
        activity: string;
        itp_sections: {
          itps: {
            itp_number: string;
            project_id: string;
            projects: { organization_id: string } | null;
          } | null;
        } | null;
      }>();

    const itp = context?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;

    let interventionLabel = intervention;
    if (organizationId) {
      const { data: levelType } = await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("label")
        .eq("organization_id", organizationId)
        .eq("code", intervention)
        .maybeSingle<{ label: string }>();
      if (levelType?.label) interventionLabel = levelType.label;
    }

    const { error: upsertError } = await supabase.from("activity_party_intervention").upsert(
      {
        itp_item_id: itpItemId,
        project_party_id: projectPartyId,
        intervention,
      },
      { onConflict: "itp_item_id,project_party_id" }
    );

    if (upsertError) {
      revalidatePath(`/inspect/itps/${itpId}`);
      return;
    }

    // Best-effort: the assigned party otherwise has no signal at all that they're now responsible
    // for a sign-off — the only other notification in this flow is notifyPartyAction, which fires
    // solely when someone manually clicks "Notify" on the resulting activity_signoff_progress row.
    // Without this, a party can go unaware of new intervention work indefinitely. Never blocks the
    // intervention assignment itself, which has already succeeded above.
    try {
      const { data: party } = await supabase
        .from("project_parties")
        .select("user_id")
        .eq("id", projectPartyId)
        .maybeSingle<{ user_id: string | null }>();

      if (party?.user_id && itp && organizationId) {
        await createNotification(supabase, {
          organizationId,
          projectId: itp.project_id,
          recipientUserId: party.user_id,
          title: `${interventionLabel} point assigned to you`,
          body: `${context?.activity} (${itp.itp_number})`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    } catch {
      // Notification delivery is best-effort — see comment above.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
}

const NEXT_STATUS = {
  draft: "under_review",
  under_review: "approved",
} as const;

export interface AdvanceItpStatusState {
  error: string | null;
}

/**
 * R79: configurable required reviewer/approver. Changed from a plain `(formData) => void` action to
 * the AddItemState-style `(prevState, formData) => State` shape (see AddItemState above) so a
 * restriction failure has somewhere to surface — a silent no-op here would be a worse UX regression
 * than the gap this closes (a staffer clicking "Approve" and nothing happening, with no explanation,
 * is strictly worse than today's unrestricted behaviour). The caller in
 * app/inspect/itps/[id]/page.tsx now uses useActionState instead of a plain `<form action={...}>`.
 */
export async function advanceItpStatusAction(
  _prev: AdvanceItpStatusState,
  formData: FormData
): Promise<AdvanceItpStatusState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const fromStatus = String(formData.get("from_status") ?? "").trim() as keyof typeof NEXT_STATUS;
  const nextStatus = NEXT_STATUS[fromStatus];
  if (!nextStatus) return { error: null };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Look up this org's approval-workflow config (if any) before writing the status change — a
  // missing row (the common case: no org has configured this) means "unrestricted", identical to
  // today's behaviour, exactly like intervention levels' three-tier notice-hours fallback pattern
  // elsewhere in this file. An Admin can always override a configured restriction (this app's
  // existing "Admin can do anything a more specific role can" convention — see isAdminStaff's own
  // doc comment).
  if (!isAdminStaff(session)) {
    const { data: itpOrg } = await supabase
      .from("itps")
      .select("projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{ projects: { organization_id: string } | null }>();
    const organizationId = itpOrg?.projects?.organization_id;

    if (organizationId) {
      const { data: workflowConfig } = await supabase
        .from(ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE)
        .select("required_reviewer_user_id, required_approver_user_id")
        .eq("organization_id", organizationId)
        .maybeSingle<ItpApprovalWorkflowConfigRow>();

      const requiredUserId =
        nextStatus === "under_review"
          ? workflowConfig?.required_reviewer_user_id
          : workflowConfig?.required_approver_user_id;

      if (requiredUserId && requiredUserId !== session.userId) {
        const { data: requiredUser } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", requiredUserId)
          .maybeSingle<{ full_name: string }>();
        const step = nextStatus === "under_review" ? "submitted for review" : "approved";
        return {
          error: `This ITP can only be ${step} by ${requiredUser?.full_name ?? "a specific reviewer"} (or a JAGS Admin), per this organisation's configured approval workflow.`,
        };
      }
    }
  }

  const now = new Date().toISOString();
  const update =
    nextStatus === "under_review"
      ? { status: nextStatus, reviewed_by: user?.id ?? null, reviewed_at: now }
      : { status: nextStatus, approved_by: user?.id ?? null, approved_at: now };

  const { error } = await supabase.from("itps").update(update).eq("id", itpId).eq("status", fromStatus);

  if (error) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return { error: "Could not update the ITP status. Check you have permission and try again." };
  }

  // Best-effort: fetched once and reused by every side-effect below (audit trail, submit-for-review
  // staff notification, initial-issue revision snapshot, client-acceptance notification) — none of
  // these block the status change itself, which has already succeeded (error was already checked above).
  if (!error) {
    try {
      const { data: itp } = await supabase
        .from("itps")
        .select("itp_number, title, project_id, projects(organization_id)")
        .eq("id", itpId)
        .maybeSingle<{
          itp_number: string;
          title: string;
          project_id: string;
          projects: { organization_id: string } | null;
        }>();

      const organizationId = itp?.projects?.organization_id;

      if (organizationId) {
        // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
        // status change above — see lib/audit/log.ts's doc comment.
        await recordAuditEvent(supabase, {
          organizationId,
          projectId: itp.project_id,
          entityType: "itp",
          entityId: itpId,
          action: "status_changed",
          actorId: user?.id ?? null,
          summary: `ITP ${itp.itp_number} moved to ${nextStatus}`,
        });
      }

      // Best-effort: a self-managed client's own party can now submit its own draft ITP for review
      // (itps_client_submit_for_review, 20260921000000_self_managed_submit_and_checklist_gen.sql) —
      // JAGS still has to Approve, so whichever JAGS staff can reach this org need to actually notice
      // the new "under_review" ITP is waiting on them, rather than a client-driven submission going
      // unnoticed until someone happens to check the register. Never fires for a JAGS-staff submission
      // (nothing for staff to notify themselves about).
      if (nextStatus === "under_review" && organizationId) {
        const { data: submitter } = user
          ? await supabase.from("users").select("is_jags_staff").eq("id", user.id).maybeSingle<{ is_jags_staff: boolean }>()
          : { data: null };

        if (!submitter?.is_jags_staff) {
          const { data: grants } = await supabase
            .from("access_grants")
            .select("user_id")
            .or(`scope_type.eq.global,organization_id.eq.${organizationId},project_id.eq.${itp?.project_id}`)
            .returns<{ user_id: string }[]>();

          const staffUserIds = new Set((grants ?? []).map((g) => g.user_id));
          if (staffUserIds.size > 0) {
            const { data: staffUsers } = await supabase
              .from("users")
              .select("id")
              .in("id", Array.from(staffUserIds))
              .eq("is_jags_staff", true)
              .returns<{ id: string }[]>();

            for (const staffUser of staffUsers ?? []) {
              await createNotification(supabase, {
                organizationId,
                projectId: itp?.project_id ?? null,
                recipientUserId: staffUser.id,
                title: "ITP submitted for review",
                body: `${itp?.itp_number} — ${itp?.title}`,
                link: `/inspect/itps/${itpId}`,
              });
            }
          }
        }
      }

      if (nextStatus === "approved") {
        // R101: revision 0's baseline snapshot is written the moment the document is first
        // genuinely "issued" — this is that moment.
        await snapshotInitialIssue(supabase, itpId, user?.id ?? null);

        // Once Approved, the client's own acceptance is the next real step in the workflow
        // (accept_itp()) — notify their linked user directly rather than relying on them noticing
        // it on their own dashboard.
        if (itp && organizationId) {
          const { data: clientParty } = await supabase
            .from("project_parties")
            .select("user_id")
            .eq("project_id", itp.project_id)
            .eq("party_type", "client")
            .not("user_id", "is", null)
            .returns<{ user_id: string | null }[]>();

          for (const party of clientParty ?? []) {
            if (!party.user_id) continue;
            await createNotification(supabase, {
              organizationId,
              projectId: itp.project_id,
              recipientUserId: party.user_id,
              title: "ITP ready for your acceptance",
              body: `${itp.itp_number} — ${itp.title}`,
              link: `/inspect/itps/${itpId}`,
            });
          }
        }
      }
    } catch {
      // Best-effort — see comment above.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface AcceptItpState {
  error: string | null;
}

/**
 * Real bug found live: this used to call the accept_itp RPC and completely ignore any error it
 * raised (no destructuring, no check) — the button just silently did nothing whenever the RPC
 * rejected the call, with zero feedback to the client clicking it. Now returns a real error state
 * (mirroring advanceItpStatusAction's own fix for the same class of problem) so accept_itp's actual
 * exception message — e.g. "Only the client party's own login can accept this ITP" or "ITP must be
 * approved before it can be accepted" — reaches the screen instead of vanishing.
 */
export async function acceptItpAction(_prev: AcceptItpState, formData: FormData): Promise<AcceptItpState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: rpcError } = await supabase.rpc("accept_itp", { target_itp_id: itpId });
  if (rpcError) {
    return { error: rpcError.message || "Could not accept this ITP." };
  }

  // Best-effort: confirm the RPC actually landed (status is now client_accepted) before recording
  // it, rather than assuming success — the audit trail is a convenience layer on top of the real
  // mutation, never a source of truth of its own. Never blocks the caller either way.
  try {
    const { data: itp } = await supabase
      .from("itps")
      .select("itp_number, status, project_id, projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{
        itp_number: string;
        status: string;
        project_id: string;
        projects: { organization_id: string } | null;
      }>();

    if (itp?.status === "client_accepted" && itp.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "accepted",
        actorId: user?.id ?? null,
        summary: `ITP ${itp.itp_number} accepted by client`,
      });
    }
  } catch {
    // Best-effort — see doc comment above.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface RecordExternalApprovalState {
  error: string | null;
}

/**
 * R80: records that a client approved this ITP in their OWN external system (e.g. a document
 * control platform) rather than by clicking Accept in this app — a reference number/date from that
 * system, so the paper trail still lands somewhere even when the client's real sign-off never
 * touches this UI. Staff-only (mirrors every other staff-gated write in this file, e.g.
 * addItpItemAction relies on RLS + canEditContent; here there's no equivalent non-staff path at all,
 * so the check is explicit) — not editable inline by anyone else, but re-submittable by staff to
 * correct a typo'd reference without a separate edit-lock flow.
 */
export async function recordExternalApprovalAction(
  _prev: RecordExternalApprovalState,
  formData: FormData
): Promise<RecordExternalApprovalState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can record an external approval reference." };
  }

  const itpId = String(formData.get("itp_id") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();

  if (!itpId || !reference) {
    return { error: "A reference is required." };
  }

  const supabase = await createSupabaseServerClient();

  // R80: "QMP internal approval is completed -> ... -> record the EXTERNAL APPROVAL REFERENCE" —
  // this was previously only enforced by the page not rendering the form before internal approval,
  // which a direct POST to this action could bypass. Re-checked here so the rule holds regardless
  // of caller.
  const { data: itp } = await supabase.from("itps").select("status").eq("id", itpId).maybeSingle<{ status: string }>();
  if (!itp || !["approved", "client_accepted"].includes(itp.status)) {
    return { error: "This ITP must be internally approved before recording an external approval reference." };
  }

  const { error } = await supabase
    .from("itps")
    .update({
      external_approval_reference: reference,
      external_approval_recorded_by: session.userId,
      external_approval_recorded_at: new Date().toISOString(),
    })
    .eq("id", itpId);

  if (error) {
    return { error: "Could not save the external approval reference. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface TranslateItpContentState {
  error: string | null;
  translated: string | null;
  targetLanguage: string | null;
}

const EMPTY_TRANSLATE_STATE: TranslateItpContentState = { error: null, translated: null, targetLanguage: null };

/**
 * R111: translates this ITP's own title + scope (whatever it actually has recorded — never any
 * other project's data) into a language the user picks from the UI dropdown, for display alongside
 * the original. This is a pure display aid: nothing here is ever written back to the itp row, and
 * translating never touches title/scope/applicable_standard themselves — only
 * generateItpDraftAction/createItpFromDraftAction and the section/item editors do that.
 */
export async function translateItpContentAction(
  _prev: TranslateItpContentState,
  formData: FormData
): Promise<TranslateItpContentState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const targetLanguage = String(formData.get("target_language") ?? "").trim();

  if (!itpId || !targetLanguage) {
    return { ...EMPTY_TRANSLATE_STATE, error: "Missing ITP or target language." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: itp } = await supabase
    .from("itps")
    .select("title, scope, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ title: string; scope: string | null; project_id: string; projects: { organization_id: string } | null }>();

  if (!itp || !itp.projects) {
    return { ...EMPTY_TRANSLATE_STATE, error: "ITP not found." };
  }

  const gate = await assertAiAllowed(supabase, itp.projects.organization_id);
  if (!gate.allowed) return { ...EMPTY_TRANSLATE_STATE, error: gate.reason };

  const sourceText = [itp.title, itp.scope].filter(Boolean).join("\n\n");
  if (!sourceText.trim()) {
    return { ...EMPTY_TRANSLATE_STATE, error: "This ITP has no title or scope text to translate yet." };
  }

  try {
    const translated = await geminiProvider.translateText({ text: sourceText, targetLanguage });
    await logAiUsage(supabase, {
      organizationId: itp.projects.organization_id,
      userId: user?.id ?? null,
      feature: "content_translation",
      modelId: getGeminiModel("content_translation"),
      promptVersion: PROMPT_VERSIONS.content_translation,
      sourceRef: { itpId, targetLanguage },
      aiResponse: translated,
    });
    return { error: null, translated, targetLanguage };
  } catch (err) {
    return { ...EMPTY_TRANSLATE_STATE, error: err instanceof Error ? err.message : "Could not translate this ITP's content." };
  }
}
