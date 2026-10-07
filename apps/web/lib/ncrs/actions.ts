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
import { aiErrorMessage } from "@/lib/ai/config";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider } from "@/lib/ai/gemini-provider";
import { getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { resolveQuickActionStatus } from "@/lib/ncrs/status-logic";
import { hasPermission } from "@/lib/rbac/permissions";
import {
  canEditAssignment,
  canEditCapa,
  canWorkNcr,
  diffField,
  evidenceCount,
  isValidNcrPhotoPath,
  severityLabel,
  validateReturnReason,
} from "@/lib/ncrs/rules";
import { BACKGROUND_JOBS_TABLE, type RenderNcrCloseoutCertificatePayload } from "@/lib/reports/types";
import { observationMarkerPath, parseObservationMarker, serializeObservationMarker } from "@/lib/offline/idempotency";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Best-effort notification: never throws. */
async function notifySafe(
  supabase: Supabase,
  params: { organizationId: string; projectId: string; recipientUserId: string | null | undefined; title: string; body?: string; link: string },
  skipUserId?: string | null
) {
  if (!params.recipientUserId || params.recipientUserId === skipUserId) return;
  try {
    await createNotification(supabase, { ...params, recipientUserId: params.recipientUserId });
  } catch {
    // Best-effort.
  }
}

/** The login (if any) linked to a project party. */
async function partyUserIdOf(supabase: Supabase, partyId: string | null | undefined): Promise<string | null> {
  if (!partyId) return null;
  const { data } = await supabase
    .from("project_parties")
    .select("user_id")
    .eq("id", partyId)
    .maybeSingle<{ user_id: string | null }>();
  return data?.user_id ?? null;
}

/** JAGS staff who may verify/close: admin staff (null staff_role counts as admin). */
async function staffVerifierIds(supabase: Supabase): Promise<string[]> {
  const { data } = await supabase
    .from("users")
    .select("id, staff_role")
    .eq("is_jags_staff", true)
    .eq("is_active", true)
    .returns<{ id: string; staff_role: string | null }[]>();
  return (data ?? []).filter((u) => u.staff_role !== "inspector").map((u) => u.id);
}

/** Close/reopen authority: admin staff or a close_ncr permission holder. */
async function mayCloseNcr(session: Awaited<ReturnType<typeof requireSession>>, projectId: string): Promise<boolean> {
  return isAdminStaff(session) || (await hasPermission(session.userId, "close_ncr", projectId));
}

/** Validates the assignee has project access and the party belongs to the project. */
async function validateAssignment(
  supabase: Supabase,
  projectId: string,
  organizationId: string,
  assignedTo: string | null,
  partyId: string | null
): Promise<string | null> {
  if (partyId) {
    const { data: party } = await supabase
      .from("project_parties")
      .select("id")
      .eq("id", partyId)
      .eq("project_id", projectId)
      .maybeSingle<{ id: string }>();
    if (!party) return "The responsible party does not belong to this project.";
  }
  if (assignedTo) {
    const [{ data: grants }, { data: parties }] = await Promise.all([
      supabase
        .from("access_grants")
        .select("scope_type, organization_id, project_id")
        .eq("user_id", assignedTo)
        .returns<{ scope_type: string; organization_id: string | null; project_id: string | null }[]>(),
      supabase.from("project_parties").select("id").eq("project_id", projectId).eq("user_id", assignedTo).limit(1),
    ]);
    const ok =
      (grants ?? []).some(
        (g) =>
          g.scope_type === "global" ||
          (g.scope_type === "organization" && g.organization_id === organizationId) ||
          (g.scope_type === "project" && g.project_id === projectId)
      ) || (parties ?? []).length > 0;
    if (!ok) return "The assignee does not have access to this project.";
  }
  return null;
}

export interface CreateNcrState {
  error: string | null;
  /** Set only when the caller asked to stay on its page (`stay_on_page`) — see createNcrAction. */
  created?: { id: string; ncrNumber: string };
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
  // Only meaningful together with an inspection record (the specific checklist item the NCR came from).
  const checklistItemId = inspectionRecordId ? String(formData.get("checklist_item_id") ?? "").trim() || null : null;
  // R68: optional vendor/party FK — see the CreateNcrForm's party picker (scoped to this project's
  // active parties). Left null for a standalone/walkdown NCR with no specific vendor behind it.
  const responsiblePartyId = String(formData.get("responsible_party_id") ?? "").trim() || null;
  // Optional client request id: a retried submit (double click, offline replay) returns the NCR the
  // first attempt created instead of raising a duplicate. Uses the same storage-marker approach as
  // the offline observation sync (no schema column).
  const requestId = String(formData.get("request_id") ?? "").trim();

  if (!projectId || !severity || !description) {
    return { error: "Project, severity and description are required." };
  }
  if (!NCR_SEVERITIES.includes(severity)) {
    return { error: "Invalid severity." };
  }
  // Round-table finding: without a required due date, the "Overdue NCRs" dashboard metric is
  // structurally unreliable — an NCR with no due date can never be overdue. Enforced here, not
  // just via the form's `required` attribute, since this action is the actual authority boundary.
  // Default by severity when the form didn't send one (SLA: major 7d, minor 14d, observation 30d).
  const defaultDays = severity === "major_ncr" ? 7 : severity === "minor_ncr" ? 14 : 30;
  const effectiveDueDate = dueDate || new Date(Date.now() + defaultDays * 86400000).toISOString().slice(0, 10);
  if (description.length < 10) {
    return { error: "Describe the nonconformance (at least 10 characters)." };
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

  const markerPath = requestId ? observationMarkerPath(projectId, requestId) : null;
  if (markerPath) {
    let existingNcr: { id: string; ncrNumber: string } | null = null;
    try {
      const { data: marker } = await supabase.storage.from("inspection-evidence").download(markerPath);
      const existingId = marker ? parseObservationMarker(await marker.text()) : null;
      if (existingId) {
        const { data: existing } = await supabase
          .from(NCRS_TABLE)
          .select("ncr_number")
          .eq("id", existingId)
          .maybeSingle<{ ncr_number: string }>();
        if (existing) existingNcr = { id: existingId, ncrNumber: existing.ncr_number };
      }
    } catch {
      // Marker miss: fall through and create.
    }
    if (existingNcr) {
      if (formData.get("stay_on_page") === "true") return { error: null, created: existingNcr };
      redirect(`/inspect/ncrs/${existingNcr.id}`);
    }
  }

  const assignmentError = await validateAssignment(supabase, projectId, project.organization_id, assignedTo || null, responsiblePartyId);
  if (assignmentError) return { error: assignmentError };

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
        due_date: effectiveDueDate,
        raised_by: user?.id ?? null,
        itp_item_id: itpItemId,
        inspection_record_id: inspectionRecordId,
        checklist_item_id: checklistItemId,
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

  // Decision: observations stay out of the punch list (and out of readiness / open-NCR exceptions).
  // A punch item is created for them only if they are later graded up to a minor/major NCR.
  let punchError: string | null = null;
  if (severity !== "observation") {
    const punch = await createPunchItemFromSource({
      projectId,
      description: `${severityLabel(severity)}: ${description}`,
      source: "ncr",
      sourceNcrId: ncr.id,
      dueDate: effectiveDueDate,
      responsiblePartyId: responsiblePartyId ?? undefined,
    });
    punchError = punch.error;
  }

  if (markerPath) {
    try {
      await supabase.storage
        .from("inspection-evidence")
        .upload(markerPath, new Blob([serializeObservationMarker(ncr.id)], { type: "application/json" }), { upsert: true });
    } catch {
      // Best-effort.
    }
  }

  // Best-effort: whoever this NCR is assigned to should hear about it without having to notice it
  // themselves on the register. Never blocks NCR creation, which has already succeeded.
  const partyUser = await partyUserIdOf(supabase, responsiblePartyId);
  for (const recipient of new Set([assignedTo || null, partyUser])) {
    await notifySafe(
      supabase,
      {
        organizationId: project.organization_id,
        projectId,
        recipientUserId: recipient,
        title: `${severityLabel(severity)} assigned to you`,
        body: `${ncrNumber} - ${description}`,
        link: `/inspect/ncrs/${ncr.id}`,
      },
      user?.id
    );
  }

  // Photos attached on the raise form (multipart, same rules as the punch list): uploaded only now
  // the NCR row exists. Best-effort per file — a failed photo never undoes the raised NCR; it can be
  // re-added from the NCR page.
  for (const f of formData.getAll("photos")) {
    if (typeof f === "string" || !f.size || !f.type.startsWith("image/") || f.size > 25 * 1024 * 1024) continue;
    try {
      const ext = (f.name.split(".").pop() ?? "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
      const path = `${projectId}/ncrs/${ncr.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("inspection-evidence").upload(path, f, { contentType: f.type });
      if (upErr) continue;
      await supabase.from(NCR_PHOTOS_TABLE).insert({ ncr_id: ncr.id, storage_path: path, caption: null, uploaded_by: user?.id ?? null });
    } catch {
      // Best-effort.
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
    summary: `NCR ${ncrNumber} raised${punchError ? " (punch-list item could not be created)" : ""}`,
  });

  const punchMessage = punchError
    ? `${ncrNumber} was raised, but its punch-list item could not be created. Do not raise it again - open it from the register and tell an administrator.`
    : null;

  // Opened from a side panel on a register: stay where the user is (they can see the new row and
  // follow the link) instead of navigating away from the list they were working in.
  if (formData.get("stay_on_page") === "true") {
    revalidatePath("/inspect/observations");
    revalidatePath("/inspect/ncrs");
    return { error: punchMessage, created: { id: ncr.id, ncrNumber } };
  }
  if (punchMessage) {
    revalidatePath("/inspect/ncrs");
    return { error: punchMessage, created: { id: ncr.id, ncrNumber } };
  }

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
  const hasAssignee = formData.has("assigned_to");
  const hasParty = formData.has("responsible_party_id");
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

  if (closeNow && !preventiveAction) {
    return { error: "Preventive action is required before closing." };
  }

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: current } = await supabase
    .from(NCRS_TABLE)
    .select("status, raised_by, assigned_to, due_date, responsible_party_id, project_id, ncr_number, projects(organization_id)")
    .eq("id", ncrId)
    .maybeSingle<{
      status: string;
      raised_by: string | null;
      assigned_to: string | null;
      due_date: string | null;
      responsible_party_id: string | null;
      project_id: string;
      ncr_number: string;
      projects: { organization_id: string } | null;
    }>();
  if (!current) return { error: "NCR not found, or you don't have access to it." };
  if (current.status === "closed") return { error: "This NCR is already closed. Re-open it to make changes." };
  const orgId = current.projects?.organization_id ?? null;

  const currentPartyUser = await partyUserIdOf(supabase, current.responsible_party_id);
  const actor = {
    isStaff: session.isJagsStaff,
    userId: session.userId,
    raisedBy: current.raised_by,
    assignedTo: current.assigned_to,
    partyUserId: currentPartyUser,
  };

  if (closeNow) {
    // Verification needs close authority (admin staff or close_ncr holder), only from awaiting-verification.
    if (!(await mayCloseNcr(session, current.project_id))) {
      return { error: "Only a JAGS admin, or someone granted the close NCR permission, can verify and close an NCR." };
    }
    if (current.status !== "pending_verification") {
      return { error: "Send the NCR for verification first - it can only be closed from Pending verification." };
    }
    // Evidence = photos AND linked vault documents.
    const [{ count: photoCount }, { count: docCount }] = await Promise.all([
      supabase.from(NCR_PHOTOS_TABLE).select("id", { count: "exact", head: true }).eq("ncr_id", ncrId),
      supabase.from("ncr_documents" as any).select("id", { count: "exact", head: true }).eq("ncr_id", ncrId),
    ]);
    if (evidenceCount(photoCount ?? 0, docCount ?? 0) === 0) {
      return { error: "Attach at least one photo or linked document as evidence of the corrected condition before closing." };
    }
  } else if (!canWorkNcr(actor)) {
    return { error: "Only the raiser, the assignee, the responsible party or JAGS staff can update this NCR." };
  }

  if (!canEditCapa(current.status, session.isJagsStaff)) {
    return { error: "This NCR is awaiting verification and its CAPA is locked. JAGS staff can return it for rework." };
  }

  // Real gap found in a workflow audit: the person who raised the NCR shouldn't also be the one
  // certifying that it's genuinely fixed. Admins are exempt, same as every other self-certification gate.
  if (closeNow && !isAdminStaff(session) && current.raised_by && current.raised_by === session.userId) {
    return { error: "You raised this NCR — a different person must close it out." };
  }

  // CAPA text: any worker may edit. Assignment / due date / party: staff or raiser only.
  const update: Record<string, unknown> = {
    root_cause: rootCause || null,
    corrective_action: correctiveAction || null,
    preventive_action: preventiveAction || null,
    verification_notes: verificationNotes || null,
  };
  const mayAssign = canEditAssignment(actor);
  const newAssignee = hasAssignee && mayAssign ? assignedTo || null : current.assigned_to;
  const newParty = hasParty && mayAssign ? responsiblePartyId || null : current.responsible_party_id;
  // A blank due date never wipes the existing one.
  const newDue = mayAssign && dueDate ? dueDate : current.due_date;
  if (mayAssign) {
    if (hasAssignee) update.assigned_to = newAssignee;
    if (hasParty) update.responsible_party_id = newParty;
    if (dueDate) update.due_date = dueDate;
  }
  if ((newAssignee !== current.assigned_to || newParty !== current.responsible_party_id) && orgId) {
    const invalid = await validateAssignment(supabase, current.project_id, orgId, newAssignee, newParty);
    if (invalid) return { error: invalid };
  }

  if (closeNow) {
    update.status = "closed";
    update.closed_by = user?.id ?? null;
    update.closed_at = new Date().toISOString();
  } else if (current.status === "open") {
    update.status = "in_progress";
  }

  // Optimistic-concurrency guard: never clobber an NCR that closed meanwhile.
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

  // Audit assignment changes with old/new values, and tell the new assignee / party.
  if (orgId) {
    const changes: Record<string, unknown> = {};
    const dAssignee = diffField(current.assigned_to, newAssignee);
    const dDue = diffField(current.due_date, newDue);
    const dParty = diffField(current.responsible_party_id, newParty);
    if (dAssignee) changes.assigned_to = dAssignee;
    if (dDue) changes.due_date = dDue;
    if (dParty) changes.responsible_party_id = dParty;
    if (Object.keys(changes).length > 0) {
      try {
        await recordAuditEvent(supabase, {
          organizationId: orgId,
          projectId: current.project_id,
          entityType: "ncr",
          entityId: ncrId,
          action: "reassigned",
          actorId: user?.id ?? null,
          summary: `NCR ${current.ncr_number} assignment updated (${Object.keys(changes).join(", ")})`,
          changes,
        });
      } catch {
        // Best-effort.
      }
    }
    if (dAssignee && newAssignee) {
      await notifySafe(
        supabase,
        { organizationId: orgId, projectId: current.project_id, recipientUserId: newAssignee, title: "NCR assigned to you", body: current.ncr_number, link: `/inspect/ncrs/${ncrId}` },
        session.userId
      );
    }
    if (dParty && newParty) {
      await notifySafe(
        supabase,
        {
          organizationId: orgId,
          projectId: current.project_id,
          recipientUserId: await partyUserIdOf(supabase, newParty),
          title: "NCR assigned to your organisation",
          body: current.ncr_number,
          link: `/inspect/ncrs/${ncrId}`,
        },
        session.userId
      );
    }
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

  let cascadeWarning: string | null = null;

  // Closing the NCR also closes the punch list item it fed (R95-96).
  if (closeNow) {
    // Update item by item so one failure is visible rather than silently swallowed.
    const { data: linked } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id")
      .eq("source_ncr_id", ncrId)
      .in("status", ["open", "resolved"])
      .returns<{ id: string }[]>();
    const closedPunchItems: { id: string }[] = [];
    const failedPunch: string[] = [];
    for (const item of linked ?? []) {
      const { error: itemError } = await supabase
        .from(PUNCH_LIST_ITEMS_TABLE)
        .update({
          status: "closed",
          closing_evidence: verificationNotes,
          verification_notes: verificationNotes,
          resolved_by: null,
          resolved_at: null,
          closed_by: user?.id ?? null,
          closed_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (itemError) failedPunch.push(item.id);
      else closedPunchItems.push(item);
    }
    if (failedPunch.length > 0) {
      cascadeWarning = `NCR closed, but ${failedPunch.length} linked punch-list item(s) could not be closed. Close them from the punch list.`;
    }

    if (updatedNcr?.projects?.organization_id) {
      try {
        await Promise.all(
          closedPunchItems.map((item) =>
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

    // Auto-queue the close-out certificate (best-effort; the button can still regenerate it).
    try {
      await supabase.from(BACKGROUND_JOBS_TABLE).insert({
        job_type: "render_ncr_closeout_certificate",
        payload: { ncr_id: ncrId, requested_by: session.userId } satisfies RenderNcrCloseoutCertificatePayload,
      });
    } catch {
      // Best-effort.
    }

    if (updatedNcr?.projects?.organization_id) {
      await notifySafe(
        supabase,
        {
          organizationId: updatedNcr.projects.organization_id,
          projectId: updatedNcr.project_id,
          recipientUserId: updatedNcr.raised_by,
          title: "Your NCR has been closed",
          body: updatedNcr.ncr_number,
          link: `/inspect/ncrs/${ncrId}`,
        }
      );
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

    // Deliberately NOT auto-completing anything on the linked ITP item or inspection record; the
    // original inspector is told the activity is ready to be re-inspected.
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
  revalidatePath("/inspect/observations");
  return { error: cascadeWarning };
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
    let usage: GeminiTokenUsage | null = null;
    let result: { description: string; requirementNotMet: string };
    if (cached) {
      result = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.draftNcrDescription({ notes }));
      result = captured.result;
      usage = captured.usage;
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId,
      userId: user?.id ?? null,
      feature: "ncr_description_draft",
      modelId: getGeminiModel("ncr_description_draft"),
      promptVersion: PROMPT_VERSIONS.ncr_description_draft,
      sourceRef: { notes },
      aiResponse: result,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
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
      error: aiErrorMessage(err, "Could not draft a description from those notes."),
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
    let usage: GeminiTokenUsage | null = null;
    let rootCause: string;
    if (cached) {
      rootCause = cached;
    } else {
      const captured = await withGeminiUsage(() =>
        geminiProvider.suggestRootCause({
          description: ncr.description,
          requirementNotMet: ncr.requirement_not_met,
          severity: ncr.severity,
        })
      );
      rootCause = captured.result;
      usage = captured.usage;
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId: ncr.project_id,
      userId: user?.id ?? null,
      feature: "ncr_root_cause_suggestion",
      modelId: getGeminiModel("ncr_root_cause_suggestion"),
      promptVersion: PROMPT_VERSIONS.ncr_root_cause_suggestion,
      sourceRef: { ncrId, severity: ncr.severity },
      aiResponse: rootCause,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, rootCause, aiLogId: logId };
  } catch (err) {
    return { ...EMPTY_ROOT_CAUSE_STATE, error: aiErrorMessage(err, "Could not suggest a root cause.") };
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
export interface NcrStatusState {
  error: string | null;
}

export async function setNcrStatusAction(_prev: NcrStatusState, formData: FormData): Promise<NcrStatusState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const requestedStatus = String(formData.get("status") ?? "").trim();
  const status = resolveQuickActionStatus(ncrId, requestedStatus);
  if (!status) return { error: "That status change is not allowed." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cur } = await supabase
    .from(NCRS_TABLE)
    .select("status, raised_by, assigned_to, responsible_party_id, root_cause, corrective_action, preventive_action")
    .eq("id", ncrId)
    .maybeSingle<{
      status: string;
      raised_by: string | null;
      assigned_to: string | null;
      responsible_party_id: string | null;
      root_cause: string | null;
      corrective_action: string | null;
      preventive_action: string | null;
    }>();
  if (!cur) return { error: "NCR not found, or you don't have access to it." };
  const allowed =
    (cur.status === "open" && status === "in_progress") || (cur.status === "in_progress" && status === "pending_verification");
  if (!allowed) return { error: "The NCR is no longer in a state where this change applies. Refresh and try again." };
  const partyUser = await partyUserIdOf(supabase, cur.responsible_party_id);
  if (!canWorkNcr({ isStaff: session.isJagsStaff, userId: session.userId, raisedBy: cur.raised_by, assignedTo: cur.assigned_to, partyUserId: partyUser })) {
    return { error: "Only the raiser, the assignee, the responsible party or JAGS staff can change this NCR's status." };
  }
  if (status === "pending_verification" && (!cur.root_cause || !cur.corrective_action || !cur.preventive_action)) {
    return { error: "Save root cause, corrective action and preventive action before sending for verification." };
  }

  const { data: updatedNcr } = await supabase
    .from(NCRS_TABLE)
    .update({ status })
    .eq("id", ncrId)
    .eq("status", cur.status)
    .select("ncr_number, project_id, projects(organization_id)")
    .maybeSingle<{ ncr_number: string; project_id: string; projects: { organization_id: string } | null }>();
  if (!updatedNcr) return { error: "The NCR changed meanwhile. Refresh and try again." };

  const orgId = updatedNcr.projects?.organization_id;
  if (orgId) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: orgId,
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

    if (status === "pending_verification") {
      // Verifiers: JAGS staff who can close. The raiser gets an FYI.
      const verifiers = await staffVerifierIds(supabase);
      for (const recipient of new Set(verifiers)) {
        await notifySafe(
          supabase,
          { organizationId: orgId, projectId: updatedNcr.project_id, recipientUserId: recipient, title: "NCR awaiting verification", body: updatedNcr.ncr_number, link: `/inspect/ncrs/${ncrId}` },
          session.userId
        );
      }
      if (cur.raised_by && !verifiers.includes(cur.raised_by)) {
        await notifySafe(
          supabase,
          { organizationId: orgId, projectId: updatedNcr.project_id, recipientUserId: cur.raised_by, title: "Your NCR was sent for verification", body: updatedNcr.ncr_number, link: `/inspect/ncrs/${ncrId}` },
          session.userId
        );
      }
    }
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  revalidatePath("/inspect/observations");
  return { error: null };
}

export interface ReturnNcrState {
  error: string | null;
  done?: boolean;
}

/** Staff only: sends a pending-verification NCR back to In progress with a mandatory reason. */
export async function returnNcrForReworkAction(_prev: ReturnNcrState, formData: FormData): Promise<ReturnNcrState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ncrId) return { error: "Missing NCR." };
  const reasonError = validateReturnReason(reason);
  if (reasonError) return { error: reasonError };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can return an NCR for rework." };
  const supabase = await createSupabaseServerClient();

  const { data: ncr, error } = await supabase
    .from(NCRS_TABLE)
    .update({ status: "in_progress" })
    .eq("id", ncrId)
    .eq("status", "pending_verification")
    .select("ncr_number, project_id, assigned_to, responsible_party_id, projects(organization_id)")
    .maybeSingle<{ ncr_number: string; project_id: string; assigned_to: string | null; responsible_party_id: string | null; projects: { organization_id: string } | null }>();
  if (error || !ncr) return { error: "Could not return it: the NCR is not awaiting verification, or you lack permission." };

  const orgId = ncr.projects?.organization_id;
  if (orgId) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: orgId,
        projectId: ncr.project_id,
        entityType: "ncr",
        entityId: ncrId,
        action: "returned_for_rework",
        actorId: session.userId,
        summary: `NCR ${ncr.ncr_number} returned for rework: ${reason}`,
        changes: { reason },
      });
    } catch {
      // Best-effort.
    }
    await notifySafe(
      supabase,
      { organizationId: orgId, projectId: ncr.project_id, recipientUserId: ncr.assigned_to, title: "NCR returned for rework", body: `${ncr.ncr_number}: ${reason}`, link: `/inspect/ncrs/${ncrId}` },
      session.userId
    );
  }
  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  revalidatePath("/inspect/observations");
  return { error: null, done: true };
}

export interface ReopenNcrState {
  error: string | null;
}

/** Re-opens a closed NCR (close_ncr holder / admin staff) with a mandatory reason; reopens its punch items and tells the assignee and party. */
export async function reopenNcrAction(_prev: ReopenNcrState, formData: FormData): Promise<ReopenNcrState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ncrId) return { error: "Missing NCR." };
  if (reason.length < 5) return { error: "Give a reason for re-opening." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: scope } = await supabase.from(NCRS_TABLE).select("project_id").eq("id", ncrId).maybeSingle<{ project_id: string }>();
  if (!scope) return { error: "NCR not found, or you don't have access to it." };
  if (!(await mayCloseNcr(session, scope.project_id))) {
    return { error: "Only a JAGS admin, or someone granted the close NCR permission, can re-open an NCR." };
  }

  const { data: ncr, error } = await supabase
    .from(NCRS_TABLE)
    .update({ status: "in_progress", closed_by: null, closed_at: null })
    .eq("id", ncrId)
    .eq("status", "closed")
    .select("ncr_number, project_id, assigned_to, responsible_party_id, projects(organization_id)")
    .maybeSingle<{ ncr_number: string; project_id: string; assigned_to: string | null; responsible_party_id: string | null; projects: { organization_id: string } | null }>();
  if (error || !ncr) return { error: "Could not re-open: the NCR is not closed or you lack permission." };

  // Re-open linked punch items with the same bookkeeping as reopenPunchItemAction.
  const { data: linked } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("id, reopen_count")
    .eq("source_ncr_id", ncrId)
    .eq("status", "closed")
    .returns<{ id: string; reopen_count: number | null }[]>();
  let punchFailures = 0;
  for (const item of linked ?? []) {
    const { error: itemError } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .update({
        status: "open",
        reopen_reason: reason,
        reopened_by: session.userId,
        reopened_at: new Date().toISOString(),
        reopen_count: (item.reopen_count ?? 0) + 1,
        resolved_by: null,
        resolved_at: null,
        closed_by: null,
        closed_at: null,
      })
      .eq("id", item.id)
      .eq("status", "closed");
    if (itemError) punchFailures++;
  }

  const orgId = ncr.projects?.organization_id;
  if (orgId) {
    await recordAuditEvent(supabase, {
      organizationId: orgId,
      projectId: ncr.project_id,
      entityType: "ncr",
      entityId: ncrId,
      action: "reopened",
      actorId: session.userId,
      summary: `NCR ${ncr.ncr_number} re-opened: ${reason}`,
    });
    const partyUser = await partyUserIdOf(supabase, ncr.responsible_party_id);
    for (const recipient of new Set([ncr.assigned_to, partyUser])) {
      await notifySafe(
        supabase,
        { organizationId: orgId, projectId: ncr.project_id, recipientUserId: recipient, title: "NCR re-opened", body: `${ncr.ncr_number}: ${reason}`, link: `/inspect/ncrs/${ncrId}` },
        session.userId
      );
    }
  }
  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  revalidatePath("/inspect/observations");
  if (punchFailures > 0) {
    return { error: `NCR re-opened, but ${punchFailures} linked punch-list item(s) could not be re-opened. Re-open them from the punch list.` };
  }
  return { error: null };
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

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: owner } = await supabase
    .from(NCRS_TABLE)
    .select("status, project_id, raised_by, assigned_to, responsible_party_id")
    .eq("id", ncrId)
    .maybeSingle<{ status: string; project_id: string; raised_by: string | null; assigned_to: string | null; responsible_party_id: string | null }>();
  if (!owner) return { error: "NCR not found, or you don't have access to it." };
  if (owner.status === "closed") return { error: "This NCR is closed. Re-open it to add evidence." };

  const partyUser = await partyUserIdOf(supabase, owner.responsible_party_id);
  if (
    !canWorkNcr({ isStaff: session.isJagsStaff, userId: session.userId, raisedBy: owner.raised_by, assignedTo: owner.assigned_to, partyUserId: partyUser })
  ) {
    return { error: "Only the raiser, the assignee, the responsible party or JAGS staff can add evidence." };
  }

  if (!isValidNcrPhotoPath(owner.project_id, ncrId, storagePath)) {
    return { error: "That file is not stored under this NCR's evidence folder." };
  }
  // Confirm the object really exists (list its folder and look for the file name).
  const slash = storagePath.lastIndexOf("/");
  const { data: listed } = await supabase.storage
    .from("inspection-evidence")
    .list(storagePath.slice(0, slash), { search: storagePath.slice(slash + 1), limit: 10 });
  if (!(listed ?? []).some((o) => o.name === storagePath.slice(slash + 1))) {
    return { error: "The uploaded file could not be found. Upload it again." };
  }

  const { error } = await supabase.from(NCR_PHOTOS_TABLE).insert({
    ncr_id: ncrId,
    storage_path: storagePath,
    caption: caption || null,
    uploaded_by: session.userId,
  });

  if (error) {
    return { error: "Could not save the photo record. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  revalidatePath("/inspect/observations");
  return { error: null };
}

export async function findOpenNcrsForItemAction(
  itpItemId: string
): Promise<{ id: string; ncr_number: string; description: string; status: string }[]> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from(NCRS_TABLE)
    .select("id, ncr_number, description, status")
    .eq("itp_item_id", itpItemId)
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(5)
    .returns<{ id: string; ncr_number: string; description: string; status: string }[]>();
  return data ?? [];
}

export interface NcrDocumentState {
  error: string | null;
  done?: boolean;
}

/** Links approved Document Vault files from the NCR's own project as evidence. */
export async function linkNcrDocumentAction(_prev: NcrDocumentState, formData: FormData): Promise<NcrDocumentState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const ids = formData.getAll("vault_document_id").map(String).filter(Boolean);
  if (!ncrId) return { error: "Missing NCR." };
  if (ids.length === 0) return { error: "Select at least one file." };

  await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: ncr } = await supabase
    .from(NCRS_TABLE)
    .select("project_id, status")
    .eq("id", ncrId)
    .maybeSingle<{ project_id: string; status: string }>();
  if (!ncr) return { error: "NCR not found, or you don't have access to it." };
  if (ncr.status === "closed") return { error: "This NCR is closed. Re-open it to add evidence." };

  const { data: docs } = await supabase
    .from("vault_documents")
    .select("id, status, vault_folders!inner(project_id)")
    .in("id", ids)
    .eq("vault_folders.project_id", ncr.project_id)
    .eq("status", "approved")
    .returns<{ id: string }[]>();
  const valid = (docs ?? []).map((d) => d.id);
  if (valid.length === 0) return { error: "Only approved files from this project's Document Vault can be linked." };

  const { error } = await supabase.from("ncr_documents" as any).upsert(
    valid.map((id) => ({ ncr_id: ncrId, vault_document_id: id, linked_by: user?.id ?? null })),
    { onConflict: "ncr_id,vault_document_id", ignoreDuplicates: true }
  );
  if (error) return { error: "Could not link the documents. Check you have permission and try again." };

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  return { error: null, done: true };
}

export async function unlinkNcrDocumentAction(input: { ncrId: string; linkId: string }): Promise<NcrDocumentState> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: ncr } = await supabase.from(NCRS_TABLE).select("status").eq("id", input.ncrId).maybeSingle<{ status: string }>();
  if (!ncr) return { error: "NCR not found." };
  if (ncr.status === "closed") return { error: "This NCR is closed. Re-open it to change evidence." };
  const { error } = await supabase.from("ncr_documents" as any).delete().eq("id", input.linkId).eq("ncr_id", input.ncrId);
  if (error) return { error: "Could not remove the document." };
  revalidatePath(`/inspect/ncrs/${input.ncrId}`);
  return { error: null, done: true };
}

export interface GradeNcrState {
  error: string | null;
  done?: boolean;
}

/** Staff only: grades an open observation up to a minor or major NCR, with a mandatory reason. */
export async function gradeObservationToNcrAction(_prev: GradeNcrState, formData: FormData): Promise<GradeNcrState> {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const severity = String(formData.get("severity") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!ncrId) return { error: "Missing record." };
  if (severity !== "minor_ncr" && severity !== "major_ncr") return { error: "Choose minor or major NCR." };
  if (reason.length < 5) return { error: "Give a reason for grading this observation up." };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can grade an observation to an NCR." };
  const supabase = await createSupabaseServerClient();

  const dueDate = new Date(Date.now() + (severity === "major_ncr" ? 7 : 14) * 86400000).toISOString().slice(0, 10);
  const { data: ncr, error } = await supabase
    .from(NCRS_TABLE)
    .update({ severity, due_date: dueDate })
    .eq("id", ncrId)
    .eq("severity", "observation")
    .neq("status", "closed")
    .select("ncr_number, project_id, assigned_to, raised_by, description, responsible_party_id, projects(organization_id)")
    .maybeSingle<{
      ncr_number: string;
      project_id: string;
      assigned_to: string | null;
      raised_by: string | null;
      description: string;
      responsible_party_id: string | null;
      projects: { organization_id: string } | null;
    }>();
  if (error || !ncr) return { error: "Could not grade: it is not an open observation, or you lack permission." };

  // Keep the punch list in step: update any existing linked item, otherwise create the one
  // observations never had (observations are not punch-list sources until graded up).
  const gradedDescription = `${severityLabel(severity)}: ${ncr.description}`;
  const { data: existingItems } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("id")
    .eq("source_ncr_id", ncrId)
    .neq("status", "closed")
    .returns<{ id: string }[]>();
  let punchWarning = "";
  if ((existingItems ?? []).length > 0) {
    const { error: puErr } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .update({ description: gradedDescription, due_date: dueDate })
      .eq("source_ncr_id", ncrId)
      .neq("status", "closed");
    if (puErr) punchWarning = " The linked punch-list item could not be updated.";
  } else {
    const created = await createPunchItemFromSource({
      projectId: ncr.project_id,
      description: gradedDescription,
      source: "ncr",
      sourceNcrId: ncrId,
      dueDate,
      responsiblePartyId: ncr.responsible_party_id ?? undefined,
    });
    if (created.error) punchWarning = " The punch-list item could not be created.";
  }

  const label = severity === "major_ncr" ? "Major NCR" : "Minor NCR";
  const orgId = ncr.projects?.organization_id;
  if (orgId) {
    await recordAuditEvent(supabase, {
      organizationId: orgId,
      projectId: ncr.project_id,
      entityType: "ncr",
      entityId: ncrId,
      action: "status_changed",
      actorId: session.userId,
      summary: `${ncr.ncr_number} graded from Observation to ${label}: ${reason}`,
    });
    for (const recipient of new Set([ncr.assigned_to, ncr.raised_by].filter((u): u is string => !!u && u !== session.userId))) {
      try {
        await createNotification(supabase, {
          organizationId: orgId,
          projectId: ncr.project_id,
          recipientUserId: recipient,
          title: `Observation graded to ${label}`,
          body: `${ncr.ncr_number}: ${reason}. New due date ${dueDate}.`,
          link: `/inspect/ncrs/${ncrId}`,
        });
      } catch {
        // Best-effort.
      }
    }
  }
  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  revalidatePath("/inspect/observations");
  return { error: punchWarning ? `Graded to ${label}.${punchWarning}` : null, done: true };
}
