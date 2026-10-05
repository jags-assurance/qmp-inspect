"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { recordAuditEvent } from "@/lib/audit/log";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { VAULT_DOCUMENT_APPROVERS_TABLE } from "@/lib/vault/approval-types";

export interface SetDocumentApproversState {
  error: string | null;
}

/**
 * Custom option: require SPECIFIC extra people to independently agree before a document counts as
 * approved, instead of the default "first person with the permission clicks Approve" — set any time
 * before the document is fully approved (typically right after upload, from its detail page).
 * Replaces whatever set was configured before (delete + re-insert) rather than trying to diff, since
 * this is a low-frequency admin action, not a hot path. Staff-only — configuring WHO must agree is as
 * sensitive as approving itself.
 */
export async function setDocumentApproversAction(
  _prev: SetDocumentApproversState,
  formData: FormData
): Promise<SetDocumentApproversState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can set who must approve a document." };
  }

  const documentId = String(formData.get("document_id") ?? "").trim();
  const approverUserIds = formData.getAll("approver_user_ids").map((v) => String(v).trim()).filter(Boolean);
  if (!documentId) return { error: "Missing document." };

  const supabase = await createSupabaseServerClient();

  const { data: doc } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("status")
    .eq("id", documentId)
    .maybeSingle<{ status: string }>();
  if (doc?.status === "approved") {
    return { error: "This document is already approved — the approver list can't be changed after the fact." };
  }

  const { error: clearError } = await supabase.from(VAULT_DOCUMENT_APPROVERS_TABLE).delete().eq("document_id", documentId);
  if (clearError) return { error: "Could not update the approver list. Check you have permission and try again." };

  if (approverUserIds.length > 0) {
    const { error } = await supabase.from(VAULT_DOCUMENT_APPROVERS_TABLE).insert(
      approverUserIds.map((userId) => ({ document_id: documentId, approver_user_id: userId }))
    );
    if (error) {
      return { error: "Could not save the required approvers. Check you have permission and try again." };
    }
  }

  revalidatePath(`/inspect/vault`);
  return { error: null };
}

export interface ApproveDocumentState {
  error: string | null;
}

/**
 * The one Approve action, aware of both shapes: a document with no configured approvers keeps
 * today's exact single-click behaviour (any permitted person flips it straight to approved); a
 * document with a configured approver list instead marks THIS caller's own row approved and only
 * flips the document itself once every required row is approved — same "all must agree" model as
 * the ITP review chain, just parallel instead of ordered (there's no reason one named approver
 * should have to wait for another's turn on a document, unlike a strict review hierarchy).
 */
export async function approveDocumentAction(
  _prev: ApproveDocumentState,
  formData: FormData
): Promise<ApproveDocumentState> {
  const session = await requireSession();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const folderId = String(formData.get("folder_id") ?? "").trim();
  if (!documentId) return { error: "Missing document." };

  const supabase = await createSupabaseServerClient();

  // Never trust a client-posted flag: work out server-side whether this caller may approve outright.
  const canApproveGenerally =
    isAdminStaff(session) || (await hasPermission(session.userId, "approve_vault_document", projectId || undefined));

  const { data: approvers } = await supabase
    .from(VAULT_DOCUMENT_APPROVERS_TABLE)
    .select("id, approver_user_id, status")
    .eq("document_id", documentId)
    .returns<{ id: string; approver_user_id: string; status: "pending" | "approved" }[]>();

  if (!approvers || approvers.length === 0) {
    // No configured approver list — original single-click behaviour.
    if (!canApproveGenerally) {
      return { error: "Only a JAGS Admin, or someone granted this permission, can approve a document." };
    }
    const { data: approvedRows, error } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .update({ status: "approved", approved_by: session.userId, approved_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("status", "for_review")
      .select("id");
    if (error) return { error: "Could not approve the document. Check you have permission and try again." };
    if (!approvedRows?.length) return { error: "This document is no longer awaiting review (it may already be approved or superseded)." };
  } else {
    const myRow = approvers.find((a) => a.approver_user_id === session.userId);
    if (!myRow) {
      return { error: "This document requires specific named approvers, and you aren't one of them." };
    }

    // Real gap found in a transactional-integrity audit: if the finalization write below ever
    // failed after this row was already marked approved, the OLD code permanently blocked that
    // same approver from ever re-triggering it ("You've already approved this document.") — with
    // every other approver also already 'approved', there was no path left to unstick the
    // document from 'for_review'. Now self-healing: re-clicking when you've already approved is a
    // no-op on your own row, but still re-attempts finalization if it's still outstanding.
    if (myRow.status !== "approved") {
      const { error: myError } = await supabase
        .from(VAULT_DOCUMENT_APPROVERS_TABLE)
        .update({ status: "approved", reviewed_at: new Date().toISOString() })
        .eq("id", myRow.id);
      if (myError) return { error: "Could not record your approval. Try again." };
    }

    const stillPending = approvers.filter((a) => a.id !== myRow.id && a.status !== "approved").length;
    if (stillPending === 0) {
      const { error } = await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .update({ status: "approved", approved_by: session.userId, approved_at: new Date().toISOString() })
        .eq("id", documentId)
        .eq("status", "for_review");
      if (error) return { error: "Recorded your approval, but could not finalize the document — try again, it will retry automatically." };
    } else if (myRow.status === "approved") {
      return { error: "You've already approved this document — still waiting on the other required approver(s)." };
    }
  }

  // Once THIS revision is approved, retire any earlier revision of the same document reference.
  try {
    const { data: approvedDoc } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, folder_id, document_reference, status")
      .eq("id", documentId)
      .maybeSingle<{ id: string; folder_id: string; document_reference: string | null; status: string }>();
    if (approvedDoc?.status === "approved" && approvedDoc.document_reference) {
      await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .update({ status: "superseded", superseded_by: approvedDoc.id })
        .eq("folder_id", approvedDoc.folder_id)
        .eq("document_reference", approvedDoc.document_reference)
        .neq("id", approvedDoc.id)
        .neq("status", "superseded");
    }
  } catch {
    // Best-effort — the approval itself already succeeded.
  }

  try {
    const { data: document } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("title, status, vault_folders(project_id, projects(organization_id))")
      .eq("id", documentId)
      .maybeSingle<{
        title: string;
        status: string;
        vault_folders: { project_id: string; projects: { organization_id: string } | null } | null;
      }>();
    const organizationId = document?.vault_folders?.projects?.organization_id;
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: document?.vault_folders?.project_id ?? projectId ?? null,
        entityType: "vault_document",
        entityId: documentId,
        action: document?.status === "approved" ? "approved" : "approval_step_recorded",
        actorId: session.userId,
        summary: `Document "${document?.title ?? documentId}" ${document?.status === "approved" ? "approved" : "approval step recorded"}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  if (projectId && folderId) revalidatePath(`/inspect/vault/${projectId}/${folderId}`);
  return { error: null };
}

export interface RejectDocumentState {
  error: string | null;
}

/**
 * Sends a document back with a written reason. Same authority as approving: a JAGS Admin, someone
 * granted approve_vault_document, or, when an approver list is configured, one of the named
 * approvers. A rejected document can't be linked as evidence and isn't in the download pack; a new
 * upload with the same document reference replaces it.
 */
export async function rejectDocumentAction(
  _prev: RejectDocumentState,
  formData: FormData
): Promise<RejectDocumentState> {
  const session = await requireSession();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const folderId = String(formData.get("folder_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!documentId) return { error: "Missing document." };
  if (reason.length < 5) return { error: "Give a reason for rejecting (at least 5 characters)." };

  const supabase = await createSupabaseServerClient();

  const { data: approvers } = await supabase
    .from(VAULT_DOCUMENT_APPROVERS_TABLE)
    .select("id, approver_user_id")
    .eq("document_id", documentId)
    .returns<{ id: string; approver_user_id: string }[]>();

  const isNamedApprover = (approvers ?? []).some((a) => a.approver_user_id === session.userId);
  const allowed =
    isAdminStaff(session) ||
    isNamedApprover ||
    (await hasPermission(session.userId, "approve_vault_document", projectId || undefined));
  if (!allowed) {
    return { error: "Only a JAGS Admin, a named approver, or someone granted the approve permission can reject a document." };
  }

  const { data: rejectedRows, error } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .update({
      status: "rejected",
      rejected_by: session.userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", documentId)
    .eq("status", "for_review")
    .select("id, title, vault_folders(project_id, projects(organization_id))")
    .returns<{ id: string; title: string; vault_folders: { project_id: string; projects: { organization_id: string } | null } | null }[]>();
  if (error) return { error: "Could not reject the document. Check you have permission and try again." };
  if (!rejectedRows?.length) return { error: "This document is no longer awaiting review." };

  if (isNamedApprover) {
    await supabase
      .from(VAULT_DOCUMENT_APPROVERS_TABLE)
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("document_id", documentId)
      .eq("approver_user_id", session.userId);
  }

  try {
    const doc = rejectedRows[0];
    const organizationId = doc.vault_folders?.projects?.organization_id;
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: doc.vault_folders?.project_id ?? null,
        entityType: "vault_document",
        entityId: documentId,
        action: "rejected",
        actorId: session.userId,
        summary: `Document "${doc.title}" rejected: ${reason}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  if (projectId && folderId) revalidatePath(`/inspect/vault/${projectId}/${folderId}`);
  return { error: null };
}
