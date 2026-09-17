"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  NCRS_TABLE,
  NCR_PHOTOS_TABLE,
  NCR_SEVERITIES,
  type NcrSeverity,
  type NcrStatus,
} from "@/lib/ncrs/types";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage } from "@/lib/ai/log";
import { geminiProvider } from "@/lib/ai/gemini-provider";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";

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

  if (!projectId || !severity || !description) {
    return { error: "Project, severity and description are required." };
  }
  if (!NCR_SEVERITIES.includes(severity)) {
    return { error: "Invalid severity." };
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

  // Routed through the shared numbering engine (Phase 2) rather than an inline per-project count —
  // NCR numbering is a clean fit for it (one sequence per project, no sub-type prefix to preserve,
  // unlike e.g. standalone assignments' FAT/WIT/... prefixes, which stay on their own local scheme).
  const { documentNumber: ncrNumber } = await generateDocumentNumber(supabase, {
    organizationId: project.organization_id,
    projectId,
    docType: "ncr",
    projectNumber: project.project_number,
  });

  const { data: ncr, error } = await supabase
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
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !ncr) {
    if (error?.code === "23505") {
      return { error: "An NCR with that number already exists for this project." };
    }
    if (error?.code === "23503") {
      return { error: "The assigned-to user ID doesn't match a known user." };
    }
    if (error?.code === "22P02") {
      return { error: "Assigned-to must be a valid user ID (UUID)." };
    }
    return { error: "Could not raise the NCR. Check you have permission and try again." };
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
  const rootCause = String(formData.get("root_cause") ?? "").trim();
  const correctiveAction = String(formData.get("corrective_action") ?? "").trim();
  const preventiveAction = String(formData.get("preventive_action") ?? "").trim();
  const verificationNotes = String(formData.get("verification_notes") ?? "").trim();
  const closeNow = formData.get("close_now") === "true";

  if (!ncrId) {
    return { error: "Missing NCR." };
  }

  if (closeNow && (!rootCause || !correctiveAction || !verificationNotes)) {
    return {
      error: "Root cause, corrective action and verification notes are required before closing.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const update: Record<string, unknown> = {
    assigned_to: assignedTo || null,
    due_date: dueDate || null,
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

  const { data: updatedNcr, error } = await supabase
    .from(NCRS_TABLE)
    .update(update)
    .eq("id", ncrId)
    .select("id, ncr_number, project_id, raised_by, projects(organization_id)")
    .maybeSingle<{
      id: string;
      ncr_number: string;
      project_id: string;
      raised_by: string | null;
      projects: { organization_id: string } | null;
    }>();

  if (error) {
    if (error.code === "23503") {
      return { error: "The assigned-to user ID doesn't match a known user." };
    }
    if (error.code === "22P02") {
      return { error: "Assigned-to must be a valid user ID (UUID)." };
    }
    return { error: "Could not update the NCR. Check you have permission and try again." };
  }

  // Closing the NCR also closes the punch list item it fed (R95-96) — the NCR's own close-out
  // fields already satisfy the punch item's closing-evidence requirement, so this reuses them
  // rather than asking for the same evidence twice.
  if (closeNow) {
    await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .update({
        status: "closed",
        closing_evidence: verificationNotes,
        closed_by: user?.id ?? null,
        closed_at: new Date().toISOString(),
      })
      .eq("source_ncr_id", ncrId)
      .eq("status", "open");

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
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  revalidatePath("/inspect/ncrs");
  return { error: null };
}

export interface DraftNcrDescriptionState {
  error: string | null;
  description: string | null;
  requirementNotMet: string | null;
}

const EMPTY_DRAFT_NCR_STATE: DraftNcrDescriptionState = { error: null, description: null, requirementNotMet: null };

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

  try {
    const result = await geminiProvider.draftNcrDescription({ notes });
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      userId: user?.id ?? null,
      feature: "ncr_description_draft",
    });
    return { error: null, description: result.description, requirementNotMet: result.requirementNotMet };
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
}

const EMPTY_ROOT_CAUSE_STATE: SuggestRootCauseState = { error: null, rootCause: null };

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

  try {
    const rootCause = await geminiProvider.suggestRootCause({
      description: ncr.description,
      requirementNotMet: ncr.requirement_not_met,
      severity: ncr.severity,
    });
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      userId: user?.id ?? null,
      feature: "ncr_root_cause_suggestion",
    });
    return { error: null, rootCause };
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
const QUICK_ACTION_STATUSES: readonly NcrStatus[] = ["in_progress", "pending_verification"];

/**
 * Plain, non-CAPA status progression for the detail page's quick-action button — deliberately
 * restricted to the two non-terminal transitions (open->in_progress, in_progress->
 * pending_verification). Closing an NCR must go through updateNcrAction, which enforces the
 * CAPA fields; this action refuses to ever set 'closed' itself.
 */
export async function setNcrStatusAction(formData: FormData) {
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as NcrStatus;
  if (!ncrId || !QUICK_ACTION_STATUSES.includes(status)) return;

  const supabase = await createSupabaseServerClient();
  await supabase.from(NCRS_TABLE).update({ status }).eq("id", ncrId);

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
