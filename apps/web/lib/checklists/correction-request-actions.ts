"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/helpers";
import { canExecuteItpItem } from "./execution-parties";
import { directoryClient, staffVerifierIds } from "@/lib/ncrs/recipients";
import { projectTeamLeadIds } from "@/lib/ncrs/unowned";
import { reopenInspectionAction } from "./lifecycle-actions";
import { withdrawSignoffAction } from "@/lib/signoff/actions";
import { approvalReason, pickCorrectionRecipients, validateCorrectionReason, CORRECTION_NOTE_MIN, CORRECTION_MAX } from "./correction-request-logic";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
// inspection_correction_requests is not in the generated shared-types yet; regenerate types and drop this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requests = (client: Supabase) => (client as any).from("inspection_correction_requests");

export interface CorrectionRequestState {
  error: string | null;
  ok?: boolean;
}

async function organizationOf(supabase: Supabase, projectId: string): Promise<string | null> {
  const { data } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
  return data?.organization_id ?? null;
}

/**
 * A contractor / party inspector who can execute an activity asks staff to correct a completed
 * inspection (or a sign-off they recorded). This only records the request and notifies team leads and
 * admins; the correction itself still needs someone who may re-open / withdraw (see resolve below).
 */
export async function requestCorrectionAction(_prev: CorrectionRequestState, formData: FormData): Promise<CorrectionRequestState> {
  const recordId = String(formData.get("inspection_record_id") ?? "").trim();
  const progressId = String(formData.get("signoff_progress_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!recordId && !progressId) return { error: "Missing inspection or sign-off." };
  const reasonError = validateCorrectionReason(reason);
  if (reasonError) return { error: reasonError };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  let projectId: string | null = null;
  let itpItemId: string | null = null;
  let label = "";
  let link = "";
  if (recordId) {
    const { data: rec } = await supabase
      .from("inspection_records")
      .select("id, project_id, record_number, itp_item_id, overall_result")
      .eq("id", recordId)
      .maybeSingle<{ id: string; project_id: string; record_number: string; itp_item_id: string; overall_result: string | null }>();
    if (!rec) return { error: "Inspection record not found." };
    if (!rec.overall_result) return { error: "This inspection is not completed, so there is nothing to correct yet." };
    projectId = rec.project_id;
    itpItemId = rec.itp_item_id;
    label = `Inspection ${rec.record_number}`;
    link = `/inspect/inspections/${rec.id}`;
  } else {
    const { data: prog } = await supabase
      .from("activity_signoff_progress")
      .select("id, itp_item_id, status")
      .eq("id", progressId)
      .maybeSingle<{ id: string; itp_item_id: string; status: string }>();
    if (!prog) return { error: "Sign-off record not found." };
    if (prog.status !== "signed_off") return { error: "Only a recorded sign-off can have a correction requested." };
    itpItemId = prog.itp_item_id;
    const { data: ctx } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(id, itp_number, project_id))")
      .eq("id", prog.itp_item_id)
      .maybeSingle<{ activity: string; itp_sections: { itps: { id: string; itp_number: string; project_id: string } | null } | null }>();
    const itp = ctx?.itp_sections?.itps;
    if (!itp) return { error: "Could not find the activity for this sign-off." };
    projectId = itp.project_id;
    label = `Sign-off on ${itp.itp_number} - ${ctx?.activity ?? "activity"}`;
    link = `/inspect/itps/${itp.id}`;
  }
  if (!projectId || !itpItemId) return { error: "Could not resolve the project." };

  // Same rule as executing the activity: staff, or an eligible party (or its team member) on it.
  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only someone who can execute this activity can request a correction." };
  }

  // One open request per target at a time.
  {
    let dup = requests(supabase).select("id").eq("status", "open").limit(1);
    dup = recordId ? dup.eq("inspection_record_id", recordId) : dup.eq("signoff_progress_id", progressId);
    const { data: existing } = await dup;
    if (existing && existing.length > 0) return { error: "A correction request is already open for this. Staff have been notified." };
  }

  const { data: created, error } = await requests(supabase)
    .insert({
      inspection_record_id: recordId || null,
      signoff_progress_id: recordId ? null : progressId,
      project_id: projectId,
      requested_by: session.userId,
      reason,
    })
    .select("id");
  if (error || !created || created.length === 0) return { error: "Could not record the correction request. Try again." };

  const organizationId = await organizationOf(supabase, projectId);
  await recordAuditEvent(supabase, {
    organizationId,
    projectId,
    entityType: recordId ? "inspection_record" : "signoff",
    entityId: recordId || progressId,
    action: "correction_requested",
    actorId: session.userId,
    summary: `Correction requested: ${label}`,
    changes: { reason, request_id: (created[0] as { id: string }).id },
  });

  if (organizationId) {
    let recipients: string[] = [];
    try {
      recipients = pickCorrectionRecipients(await projectTeamLeadIds(supabase, projectId), await staffVerifierIds(supabase), session.userId);
    } catch {
      recipients = [];
    }
    for (const recipientUserId of recipients) {
      await createNotification(supabase, {
        organizationId,
        projectId,
        recipientUserId,
        title: "Correction requested",
        body: `${session.fullName ?? "A user"} asked for a correction to ${label}: ${reason}`.slice(0, 300),
        link,
      });
    }
  }

  revalidatePath(link);
  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null, ok: true };
}

/**
 * Staff resolve a correction request. Approve runs the EXISTING re-open (or sign-off withdraw) path,
 * which keeps its own permission checks (admin or team lead): this action never loosens them. The
 * request is marked approved only if that path succeeds. Decline needs a note and tells the requester.
 */
export async function resolveCorrectionRequestAction(_prev: CorrectionRequestState, formData: FormData): Promise<CorrectionRequestState> {
  const requestId = String(formData.get("request_id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!requestId) return { error: "Missing correction request." };
  if (decision !== "approve" && decision !== "decline") return { error: "Choose approve or decline." };
  if (decision === "decline" && note.length < CORRECTION_NOTE_MIN) return { error: `A note (at least ${CORRECTION_NOTE_MIN} characters) is required to decline.` };
  if (note.length > CORRECTION_MAX) return { error: `The note is too long (max ${CORRECTION_MAX} characters).` };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: req } = await requests(supabase)
    .select("id, inspection_record_id, signoff_progress_id, project_id, requested_by, reason, status")
    .eq("id", requestId)
    .maybeSingle();
  const request = req as
    | { id: string; inspection_record_id: string | null; signoff_progress_id: string | null; project_id: string; requested_by: string; reason: string; status: string }
    | null;
  if (!request) return { error: "Correction request not found." };
  if (request.status !== "open") return { error: "This correction request was already resolved." };

  if (!isAdminStaff(session) && !(await isTeamLeadForProject(supabase, session.userId, request.project_id))) {
    return { error: "Only an admin or a team lead on this project can resolve a correction request." };
  }

  const { data: requester } = await directoryClient(supabase)
    .from("users")
    .select("full_name")
    .eq("id", request.requested_by)
    .maybeSingle<{ full_name: string | null }>();

  if (decision === "approve") {
    const why = approvalReason(requester?.full_name ?? null, request.reason);
    let result: { error: string | null };
    if (request.inspection_record_id) {
      const fd = new FormData();
      fd.set("inspection_record_id", request.inspection_record_id);
      fd.set("reason", why);
      result = await reopenInspectionAction({ error: null }, fd);
    } else {
      result = await withdrawSignoffAction(request.signoff_progress_id as string, why);
    }
    if (result.error) return { error: result.error };
  }

  const { data: updated, error } = await requests(supabase)
    .update({
      status: decision === "approve" ? "approved" : "declined",
      resolved_by: session.userId,
      resolved_at: new Date().toISOString(),
      resolution_note: note || null,
    })
    .eq("id", request.id)
    .eq("status", "open")
    .select("id");
  if (error || !updated || updated.length === 0) {
    return { error: decision === "approve" ? "The correction was applied but the request could not be marked approved. Refresh the page." : "Could not record the decision. Try again." };
  }

  const organizationId = await organizationOf(supabase, request.project_id);
  await recordAuditEvent(supabase, {
    organizationId,
    projectId: request.project_id,
    entityType: request.inspection_record_id ? "inspection_record" : "signoff",
    entityId: request.inspection_record_id ?? (request.signoff_progress_id as string),
    action: decision === "approve" ? "correction_approved" : "correction_declined",
    actorId: session.userId,
    summary: decision === "approve" ? "Correction request approved" : "Correction request declined",
    changes: { request_id: request.id, note: note || null },
  });

  const link = request.inspection_record_id ? `/inspect/inspections/${request.inspection_record_id}` : `/inspect/projects/${request.project_id}`;
  if (organizationId) {
    await createNotification(supabase, {
      organizationId,
      projectId: request.project_id,
      recipientUserId: request.requested_by,
      title: decision === "approve" ? "Correction request approved" : "Correction request declined",
      body: (decision === "approve" ? "Your correction request was approved; the item is open again for correction." : `Your correction request was declined: ${note}`).slice(0, 300),
      link,
    });
  }

  revalidatePath(link);
  revalidatePath(`/inspect/projects/${request.project_id}`);
  return { error: null, ok: true };
}
