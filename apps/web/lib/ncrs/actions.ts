"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import {
  NCRS_TABLE,
  NCR_PHOTOS_TABLE,
  NCR_SEVERITIES,
  type NcrSeverity,
} from "@/lib/ncrs/types";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider } from "@/lib/ai/gemini-provider";
import { getGeminiModel, PROMPT_VERSIONS } from "@/lib/ai/gemini-provider";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { resolveQuickActionStatus } from "@/lib/ncrs/status-logic";

export interface CreateNcrState {
  error: string | null;
}

export async function createNcrAction(
  _prev: CreateNcrState,
  formData: FormData
): Promise<CreateNcrState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const severity = String(formData.get("severity") ?? "").trim() as NcrSeverity;
  const description = String(formData.get("description") ?? "").trim();
  const requirementNotMet = String(formData.get("requirement_not_met") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;
  // Real FK linkage (ncrs.itp_item_id / ncrs.inspection_record_id already existed in the schema but
  // were never populated by this action) — set only when the NCR was raised FROM a specific failed
  // inspection record (app/inspect/inspections/[id]/page.tsx's "Raise NCR" link), never guessed at.
  // A standalone/walkdown NCR with no specific activity behind it still raises fine with both null.
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim() || null;
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim() || null;
  // R68: optional vendor/party FK — see the CreateNcrForm's party picker (scoped to this project's
  // active parties). Left null for a standalone/walkdown NCR with no specific vendor behind it.
  const responsiblePartyId = String(formData.get("responsible_party_id") ?? "").trim() || null;

  if (!projectId || !severity || !description) {
    return { error: "Project, severity and description are required." };
  }
  if (!NCR_SEVERITIES.includes(severity)) {
    return { error: "Invalid severity." };
  }
  // Round-table finding: without a required due date, the "Overdue NCRs" dashboard metric is
  // structurally unreliable — an NCR with no due date can never be overdue. Enforced here, not
  // just via the form's `required` attribute, since this action is the actual authority boundary.
  if (!dueDate) {
    return { error: "Due date is required." };
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
    return { error: "Project not found, or you don't have access to it." };
  }

  // R104: an NCR raised against a specific itp_item (see the FK comment above) can resolve that
  // item's own discipline — the only discipline an NCR is ever able to genuinely carry, since ncrs
  // has no discipline_id of its own. A standalone/walkdown NCR (itpItemId null) has nothing to
  // resolve, so this stays null and generateDocumentNumber simply omits the segment even if the
  // org's numbering config has include_discipline on — never a fabricated placeholder.
  let disciplineCode: string | null = null;
  if (itpItemId) {
    const { data: itemWithDiscipline } = await supabase
      .from("itp_items")
      .select("master_disciplines(code)")
      .eq("id", itpItemId)
      .maybeSingle<{ master_disciplines: { code: string } | null }>();
    disciplineCode = itemWithDiscipline?.master_disciplines?.code ?? null;
  }

  // Routed through the shared numbering engine (Phase 2) rather than an inline per-project count —
  // NCR numbering is a clean fit for it (one sequence per project, no sub-type prefix to preserve,
  // unlike e.g. standalone assignments' FAT/WIT/... prefixes, which stay on their own local scheme).
  //
  // Real bug found live: next_document_sequence itself is genuinely atomic (a single
  // INSERT ... ON CONFLICT DO UPDATE ... RETURNING — see that function's own doc comment), but a
  // project whose NCRs were ever seeded/imported with a hand-picked ncr_number (bypassing the
  // counter entirely) leaves the counter behind the highest number actually in use. The counter then
  // has to "catch up" one collision at a time — every generated number below the seeded high-water
  // mark hits the unique constraint and used to just fail outright with no retry, so raising an NCR
  // could error repeatedly on a project with any legacy numbering. Retrying with a freshly generated
  // number on that specific collision (bounded, so a genuine persistent failure still surfaces) fixes
  // it without needing to touch or backfill the counter itself.
  let ncr: { id: string } | null = null;
  let ncrNumber = "";
  let lastError: { code?: string; message: string } | null = null;

  for (let attempt = 0; attempt < 5 && !ncr; attempt++) {
    const generated = await generateDocumentNumber(supabase, {
      organizationId: project.organization_id,
      projectId,
      docType: "ncr",
      projectNumber: project.project_number,
      disciplineCode,
    });
    ncrNumber = generated.documentNumber;

    const { data, error } = await supabase
      .from(NCRS_TABLE)
      .insert({
        project_id: projectId,
        ncr_number: ncrNumber,
        severity,
        description,
        requirement_not_met: requirementNotMet || null,
        assigned_to: assignedTo || null,
        due_date: dueDate || null,
        raised_by: user?.id ?? null,
        itp_item_id: itpItemId,
        inspection_record_id: inspectionRecordId,
        responsible_party_id: responsiblePartyId,
      })
      .select("id")
      .single<{ id: string }>();

    if (data) {
      ncr = data;
      break;
    }

    lastError = error;
    if (error?.code !== "23505") break; // Only a number collision is worth retrying.
  }

  if (!ncr) {
    const error = lastError;
    if (error?.code === "23505") {
      return {
        error: "Could not generate a unique NCR number after several attempts — check the project's numbering configuration.",
      };
    }
    if (error?.code === "23503") {
      return { error: "The assigned-to user or responsible party doesn't match a known record." };
    }
    if (error?.code === "22P02") {
      return { error: "Assigned-to and responsible party must be valid IDs (UUID)." };
    }
    return { error: "Could not raise the NCR. Check you have permission and try again." };
  }

  if (aiLogId && user?.id) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: user.id,
      targetType: "ncr",
      targetId: ncr.id,
      reviewedResponse: { description, requirementNotMet },
      decision: description === (formData.get("ai_original_description") ?? "").toString().trim()
        ? "accepted_as_is"
        : "edited_and_accepted",
    });
  }

  // R95-96: every NCR/observation is a project-wide punch list source, since it represents
  // something that must be closed out before handover regardless of severity.
  await createPunchItemFromSource({
    projectId,
    description: `${severity === "major_ncr" ? "Major NCR" : severity === "minor_ncr" ? "Minor NCR" : "Observation"}: ${description}`,
    source: "ncr",
    sourceNcrId: ncr.id,
    dueDate: dueDate || undefined,
  });

  // Best-effort: whoever this NCR is assigned to should hear about it without having to notice it
  // themselves on the register. Never blocks NCR creation, which has already succeeded.
  if (assignedTo) {
    try {
      await createNotification(supabase, {
        organizationId: project.organization_id,
        projectId,
        recipientUserId: assignedTo,
        title: `${severity === "major_ncr" ? "Major NCR" : severity === "minor_ncr" ? "Minor NCR" : "Observation"} assigned to you`,
        body: `${ncrNumber} — ${description}`,
        link: `/inspect/ncrs/${ncr.id}`,
      });
    } catch {
      // Best-effort — see comment above.
    }
  }

  // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
  // creation above — see lib/audit/log.ts's doc comment.
  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "ncr",
    entityId: ncr.id,
    action: "created",
    actorId: user?.id ?? null,
    summary: `NCR ${ncrNumber} raised`,
  });

  redirect(`/inspect/ncrs/${ncr.id}`);
}

export interface UpdateNcrState {
  error: string | null;
}

/**
 * Updates the CAPA fields (root cause / corrective / preventive action / verification notes) and,
 * when requested, closes the NCR. Closure requires root cause, corrective action and verification
 * notes to already be filled in — enforced here rather than left to the UI, since this action is
 * the actual authority boundary.
 */
export async function updateNcrAction(
  _prev: UpdateNcrState,
  formData: FormData
): Promise<UpdateNcrState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  // R68: optional vendor/party FK, editable here same as assigned_to/due_date.
  const responsiblePartyId = String(formData.get("responsible_party_id") ?? "").trim();
  const rootCause = String(formData.get("root_cause") ?? "").trim();
  const correctiveAction = String(formData.get("corrective_action") ?? "").trim();
  const preventiveAction = String(formData.get("preventive_action") ?? "").trim();
  const verificationNotes = String(formData.get("verification_notes") ?? "").trim();
  const closeNow = formData.get("close_now") === "true";
  const aiLogId = String(formData.get("root_cause_ai_log_id") ?? "").trim() || null;

  if (!ncrId) {
    return { error: "Missing NCR." };
  }

  if (closeNow && (!rootCause || !correctiveAction || !verificationNotes)) {
    return {
      error: "Root cause, corrective action and verification notes are required before closing.",
    };
  }

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real gap found in a workflow audit: the punch-list close-out already blocks the same person who
  // marked an item resolved from also independently verifying it (see closePunchItemAction's own
  // comment, which explicitly claims NCR close-out avoids "the same self-certification problem" —
  // that claim was false until now). The person who raised the NCR shouldn't also be the one
  // certifying, via root cause/corrective action/verification notes, that it's genuinely fixed.
  // Admins are exempt, same as every other self-certification gate in this app.
  if (closeNow && !isAdminStaff(session)) {
    const { data: existing } = await supabase
      .from(NCRS_TABLE)
      .select("raised_by")
      .eq("id", ncrId)
      .maybeSingle<{ raised_by: string | null }>();
    if (existing?.raised_by && existing.raised_by === session.userId) {
      return { error: "You raised this NCR — a different person must close it out." };
    }
  }

  const update: Record<string, unknown> = {
    assigned_to: assignedTo || null,
    due_date: dueDate || null,
    responsible_party_id: responsiblePartyId || null,
    root_cause: rootCause || null,
    corrective_action: correctiveAction || null,
    preventive_action: preventiveAction || null,
    verification_notes: verificationNotes || null,
  };

  if (closeNow) {
    update.status = "closed";
    update.closed_by = user?.id ?? null;
    update.closed_at = new Date().toISOString();
  } else {
    update.status = "in_progress";
  }

  // Real race condition found in a workflow audit: this update had no optimistic-concurrency guard
  // at all — two concurrent submits (e.g. a stale quick-action request racing this form) could
  // interleave with last-write-wins, silently reverting an already-closed NCR back to in_progress
  // or vice versa. Excluding 'closed' rows means once an NCR is closed, only a real reopen action
  // (none exists today) can move it again — this update can never accidentally clobber it.
  const { data: updatedNcr, error } = await supabase
    .from(NCRS_TABLE)
    .update(update)
    .eq("id", ncrId)
    .neq("status", "closed")
    .select(
      "id, ncr_number, project_id, raised_by, itp_item_id, inspection_record_id, projects(organization_id)"
    )
    .maybeSingle<{
      id: string;
      ncr_number: string;
      project_id: string;
      raised_by: string | null;
      itp_item_id: string | null;
      inspection_record_id: string | null;
      projects: { organization_id: string } | null;
    }>();

  if (!error && !updatedNcr) {
    return { error: "This NCR is already closed." };
  }

  if (error) {
    if (error.code === "23503") {
      return { error: "The assigned-to user or responsible party doesn't match a known record." };
    }
    if (error.code === "22P02") {
      return { error: "Assigned-to and responsible party must be valid IDs (UUID)." };
    }
    return { error: "Could not update the NCR. Check you have permission and try again." };
  }

  if (aiLogId && user?.id && rootCause) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: user.id,
      targetType: "ncr_root_cause",
      targetId: ncrId,
      reviewedResponse: { rootCause },
      decision: rootCause === (formData.get("root_cause_ai_original") ?? "").toString().trim()
        ? "accepted_as_is"
        : "edited_and_accepted",
    });
  }

  // Closing the NCR also closes the punch list item it fed (R95-96) — the NCR's own close-out
  // fields already satisfy the punch item's closing-evidence requirement, so this reuses them
  // rather than asking for the same evidence twice.
  if (closeNow) {
    // Real gap found in a workflow audit: this only ever matched status='open' — a punch item
    // someone had already marked 'resolved' directly (bypassing the NCR) was left stranded at
    // 'resolved' forever once the NCR closed, diverging from the NCR's own now-closed state. The
    // NCR close-out (root cause + corrective action + verification notes, by a person other than
    // whoever raised it — see the self-certification check above) already IS the independent
    // verification a 'resolved' item is waiting on, so this now also picks those up and fills
    // verification_notes, not just closing_evidence.
    const { data: closedPunchItems } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .update({
        status: "closed",
        closing_evidence: verificationNotes,
        verification_notes: verificationNotes,
        closed_by: user?.id ?? null,
        closed_at: new Date().toISOString(),
      })
      .eq("source_ncr_id", ncrId)
      .in("status", ["open", "resolved"])
      .select("id")
      .returns<{ id: string }[]>();

    // Found missing in a self-review audit: this auto-close previously rode entirely on the NCR's
    // own "closed" event below, so a punch-list-only audit query would never see it. closePunchItemAction
    // (the manual close path) logs its own "closed" / punch_list_item event per item — this mirrors
    // that exactly, just for every row this NCR closed automatically instead of one clicked by hand.
    if (updatedNcr?.projects?.organization_id) {
      try {
        await Promise.all(
          (closedPunchItems ?? []).map((item) =>
            recordAuditEvent(supabase, {
              organizationId: updatedNcr.projects!.organization_id,
              projectId: updatedNcr.project_id,
              entityType: "punch_list_item",
              entityId: item.id,
              action: "closed",
              actorId: user?.id ?? null,
              summary: `Punch item auto-closed by NCR ${updatedNcr.ncr_number} closing`,
              changes: { closing_evidence: verificationNotes, source_ncr_id: ncrId },
            })
          )
        );
      } catch {
        // Best-effort — see lib/audit/log.ts's doc comment.
      }
    }

    // Best-effort: whoever raised this NCR should hear that it's now closed, without having to
    // notice it themselves on the register. Never blocks the close, which has already succeeded.
    if (updatedNcr?.raised_by && updatedNcr.projects?.organization_id) {
      try {
        await createNotification(supabase, {
          organizationId: updatedNcr.projects.organization_id,
          projectId: updatedNcr.project_id,
          recipientUserId: updatedNcr.raised_by,
          title: "Your NCR has been closed",
          body: updatedNcr.ncr_number,
          link: `/inspect/ncrs/${ncrId}`,
        });
      } catch {
        // Notification delivery is best-effort — see comment above.
      }
    }

    // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
    // close above — see lib/audit/log.ts's doc comment.
    if (updatedNcr?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: updatedNcr.projects.organization_id,
        projectId: updatedNcr.project_id,
        entityType: "ncr",
        entityId: ncrId,
        action: "closed",
        actorId: user?.id ?? null,
        summary: `NCR ${updatedNcr.ncr_number} closed`,
      });
    }

    // Deliberately NOT auto-completing anything on the linked ITP item or inspection record —
    // closing an NCR's paperwork (root cause + corrective action + verification notes) is not the
    // same as physically re-verifying the fix, and this codebase's established rule (see the R71
    // Hold-blocks-start work and the assurance-critical permission set) is that real QA verification
    // is never skipped by a paperwork close-out. What this DOES automate: the person who ran the
    // original failed inspection gets told the corrective action is confirmed and the activity is
    // ready to be re-inspected — same "Start inspection" flow as any fresh attempt, just prompted
    // instead of left for someone to notice on their own.
    if (updatedNcr?.inspection_record_id && updatedNcr.projects?.organization_id) {
      try {
        const { data: originalRecord } = await supabase
          .from(INSPECTION_RECORDS_TABLE)
          .select("inspector_id, checklist_template_id, activity")
          .eq("id", updatedNcr.inspection_record_id)
          .maybeSingle<{ inspector_id: string | null; checklist_template_id: string | null; activity: string }>();

        if (originalRecord?.inspector_id && originalRecord.checklist_template_id) {
          await createNotification(supabase, {
            organizationId: updatedNcr.projects.organization_id,
            projectId: updatedNcr.project_id,
            recipientUserId: originalRecord.inspector_id,
            title: "Linked NCR closed — ready to re-inspect",
            body: `${updatedNcr.ncr_number} — ${originalRecord.activity}. Re-inspect to confirm the fix.`,
            link: `/inspect/checklists/${originalRecord.checklist_template_id}`,
          });
        }
      } catch {
        // Notification delivery is best-effort — see comment above.
      }
    }
  }

  if (updatedNcr?.inspection_record_id) {
    revalidatePath(`/inspect/inspections/${updatedNcr.inspection_record_id}`);
  }
  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  return { error: null };
}

export interface DraftNcrDescriptionState {
  error: string | null;
  description: string | null;
  requirementNotMet: string | null;
  aiLogId: string | null;
}

const EMPTY_DRAFT_NCR_STATE: DraftNcrDescriptionState = {
  error: null,
  description: null,
  requirementNotMet: null,
  aiLogId: null,
};

/**
 * Reqs R82-R84: drafts a description/requirement_not_met pair from the inspector's raw factual
 * notes. Same non-negotiable rule as everywhere else AI touches this app — this never writes
 * anything; it only returns text for the caller to drop into the (still fully editable) textareas
 * on the NCR creation form. The NCR itself is only ever created by createNcrAction above, from
 * whatever text is actually in those fields when the user submits.
 */
export async function draftNcrDescriptionAction(
  _prev: DraftNcrDescriptionState,
  formData: FormData
): Promise<DraftNcrDescriptionState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !notes) {
    return { ...EMPTY_DRAFT_NCR_STATE, error: "Select a project and enter some field notes first." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (!project) {
    return { ...EMPTY_DRAFT_NCR_STATE, error: "Project not found, or you don't have access to it." };
  }

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) {
    return { ...EMPTY_DRAFT_NCR_STATE, error: gate.reason };
  }

  const inputHash = hashAiCacheInput(notes);
  try {
    const cached = await findCachedAiResponse<{ description: string; requirementNotMet: string }>(supabase, {
      organizationId: project.organization_id,
      feature: "ncr_description_draft",
      promptVersion: PROMPT_VERSIONS.ncr_description_draft,
      inputHash,
    });
    const result = cached ?? (await geminiProvider.draftNcrDescription({ notes }));
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      userId: user?.id ?? null,
      feature: "ncr_description_draft",
      modelId: getGeminiModel("ncr_description_draft"),
      promptVersion: PROMPT_VERSIONS.ncr_description_draft,
      sourceRef: { notes },
      aiResponse: result,
      inputHash,
      servedFromCache: !!cached,
    });
    return {
      error: null,
      description: result.description,
      requirementNotMet: result.requirementNotMet,
      aiLogId: logId,
    };
  } catch (err) {
    return {
      ...EMPTY_DRAFT_NCR_STATE,
      error: err instanceof Error ? err.message : "Could not draft a description from those notes.",
    };
  }
}

export interface SuggestRootCauseState {
  error: string | null;
  rootCause: string | null;
  aiLogId: string | null;
}

const EMPTY_ROOT_CAUSE_STATE: SuggestRootCauseState = { error: null, rootCause: null, aiLogId: null };

/**
 * Reqs R111: "suggest likely root causes for an NCR". Facts come from the NCR's own already-saved
 * description/requirement_not_met/severity — never from the client — so the suggestion can only
 * reflect what was actually recorded. Same non-negotiable rule as every other AI assist here: this
 * never writes anything, it only returns text for the (still fully editable) root_cause textarea
 * on the close-out form; updateNcrAction below is the only thing that ever persists a root cause.
 */
export async function suggestNcrRootCauseAction(
  _prev: SuggestRootCauseState,
  formData: FormData
): Promise<SuggestRootCauseState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  if (!ncrId) return { ...EMPTY_ROOT_CAUSE_STATE, error: "Missing NCR." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: ncr } = await supabase
    .from(NCRS_TABLE)
    .select("description, requirement_not_met, severity, project_id")
    .eq("id", ncrId)
    .maybeSingle<{ description: string; requirement_not_met: string | null; severity: NcrSeverity; project_id: string }>();

  if (!ncr) return { ...EMPTY_ROOT_CAUSE_STATE, error: "NCR not found." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", ncr.project_id)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_ROOT_CAUSE_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_ROOT_CAUSE_STATE, error: gate.reason };

  const inputHash = hashAiCacheInput({
    description: ncr.description,
    requirementNotMet: ncr.requirement_not_met,
    severity: ncr.severity,
  });
  try {
    const cached = await findCachedAiResponse<string>(supabase, {
      organizationId: project.organization_id,
      feature: "ncr_root_cause_suggestion",
      promptVersion: PROMPT_VERSIONS.ncr_root_cause_suggestion,
      inputHash,
    });
    const rootCause =
      cached ??
      (await geminiProvider.suggestRootCause({
        description: ncr.description,
        requirementNotMet: ncr.requirement_not_met,
        severity: ncr.severity,
      }));
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      userId: user?.id ?? null,
      feature: "ncr_root_cause_suggestion",
      modelId: getGeminiModel("ncr_root_cause_suggestion"),
      promptVersion: PROMPT_VERSIONS.ncr_root_cause_suggestion,
      sourceRef: { ncrId, severity: ncr.severity },
      aiResponse: rootCause,
      inputHash,
      servedFromCache: !!cached,
    });
    return { error: null, rootCause, aiLogId: logId };
  } catch (err) {
    return { ...EMPTY_ROOT_CAUSE_STATE, error: err instanceof Error ? err.message : "Could not suggest a root cause." };
  }
}

// Round-table finding: this action previously accepted ANY status value with no validation,
// including 'closed' — bypassing updateNcrAction's own comment that it "is the actual authority
// boundary" for closure (root cause / corrective action / verification notes required). The
// detail page's quick-action button only ever sends 'in_progress' or 'pending_verification' (see
// NEXT_STATUS in app/inspect/ncrs/[id]/page.tsx), but the server action itself had no server-side
// guard stopping a directly-crafted request from setting 'closed' with none of that evidence
// present, no closed_by/closed_at stamp, and without closing the linked punch-list item — an NCR
// could end up closed in a state indistinguishable, downstream, from a properly resolved one.
// The allow-list + validation itself lives in resolveQuickActionStatus (status-logic.ts), pulled
// out so it's unit-testable without a live DB — see lib/ncrs/__tests__/status-logic.test.ts.

/**
 * Plain, non-CAPA status progression for the detail page's quick-action button — deliberately
 * restricted to the two non-terminal transitions (open->in_progress, in_progress->
 * pending_verification). Closing an NCR must go through updateNcrAction, which enforces the
 * CAPA fields; this action refuses to ever set 'closed' itself.
 */
export async function setNcrStatusAction(formData: FormData) {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const requestedStatus = String(formData.get("status") ?? "").trim();
  const status = resolveQuickActionStatus(ncrId, requestedStatus);
  if (!status) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real race condition found in a workflow audit: this had no optimistic-concurrency guard —
  // a quick-action click racing an in-flight CAPA close (updateNcrAction) could revert an
  // already-closed NCR back to in_progress with no error surfaced to either caller.
  const { data: updatedNcr } = await supabase
    .from(NCRS_TABLE)
    .update({ status })
    .eq("id", ncrId)
    .neq("status", "closed")
    .select("ncr_number, project_id, projects(organization_id)")
    .maybeSingle<{ ncr_number: string; project_id: string; projects: { organization_id: string } | null }>();

  // Found missing in a self-review audit: this quick status nudge (open/in_progress/pending_
  // verification) had no audit trail at all, unlike updateNcrAction's own "closed" event right above
  // it — best-effort, never blocks the update above, which already succeeded.
  if (updatedNcr?.projects?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: updatedNcr.projects.organization_id,
        projectId: updatedNcr.project_id,
        entityType: "ncr",
        entityId: ncrId,
        action: "status_changed",
        actorId: user?.id ?? null,
        summary: `NCR ${updatedNcr.ncr_number} status set to ${status}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
}

export interface AddNcrPhotoState {
  error: string | null;
}

/** Records a photo already uploaded to the "inspection-evidence" bucket against an NCR. */
export async function addNcrPhotoAction(
  _prev: AddNcrPhotoState,
  formData: FormData
): Promise<AddNcrPhotoState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const storagePath = String(formData.get("storage_path") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();

  if (!ncrId || !storagePath) {
    return { error: "Upload failed — no file path was returned." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from(NCR_PHOTOS_TABLE).insert({
    ncr_id: ncrId,
    storage_path: storagePath,
    caption: caption || null,
    uploaded_by: user?.id ?? null,
  });

  if (error) {
    return { error: "Could not save the photo record. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  return { error: null };
}
