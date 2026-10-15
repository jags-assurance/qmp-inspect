"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { resolveUploadRevision } from "@/lib/vault/revision";
import { VAULT_DOCUMENTS_TABLE, type VaultDocumentRow } from "@/lib/vault/types";
import { generateDocumentNumber, NumberingError } from "@/lib/numbering/generate";
import { VAULT_EXTRACT_MAX_BYTES, VAULT_MAX_UPLOAD_BYTES, vaultFileTooLargeMessage } from "@/lib/vault/limits";
import { loadVaultUploadLimitMb } from "@/lib/vault/upload-limit";
import { extractTextFromFile } from "@/lib/vault/extract-text";
import { notifyDocumentSubmitted } from "@/lib/vault/notifications";

export interface UploadVaultDocumentState {
  error: string | null;
  documentNumber?: string;
  internalReference?: string | null;
  documentId?: string;
}

export interface UploadVaultDocumentCoreParams {
  folderId: string;
  projectId: string;
  title: string;
  documentReference: string;
  revision: string;
  documentDate: string;
  notes: string;
  storagePath: string;
  fileSize: string;
  /** null for a caller with no user session (e.g. the email-inbound webhook, R20b) — the row's
   *  uploaded_by column then stays null rather than being force-fit to some placeholder user. */
  uploadedBy: string | null;
  /** Explicit "this is the next revision of document X" (from the detail page / duplicate prompt).
   *  Works even when X has no document_reference. */
  revisesDocumentId?: string | null;
}

/**
 * Best-effort removal of an uploaded vault object whose database row could not be saved, so a failed
 * save does not leave an orphaned file. Only objects under this project's own vault/<projectId>/
 * prefix are ever removed. Never throws and never changes the caller's error.
 */
async function removeOrphanedVaultObject(supabase: SupabaseClient, projectId: string, storagePath: string): Promise<void> {
  if (!storagePath.startsWith(`vault/${projectId}/`) || storagePath.includes("..")) return;
  try {
    await supabase.storage.from("inspection-evidence").remove([storagePath]);
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * The actual record-and-supersede-and-extract logic, split out from uploadVaultDocumentAction so a
 * second, non-session caller can reuse it verbatim instead of re-implementing the storage
 * bucket/table/numbering logic — same split as completeInspectionCore in lib/checklists/actions.ts
 * (see app/api/offline-sync/route.ts's own comment for the precedent). The email-inbound webhook
 * (app/api/vault/email-inbound/route.ts, R20b) is the other caller: it has no user session to build
 * a normal createSupabaseServerClient() from, so it passes in a service-role client instead — this
 * function itself is agnostic to which kind of client it's given, it just uses whatever `supabase`
 * it's handed for every query.
 *
 * Revision handling: when `document_reference` matches an existing, still-current (non-superseded)
 * document in the same folder, that prior row is flipped to 'superseded' (with `superseded_by` set
 * to the new row) in the same operation — it stays visible, never deleted. Done here in the app
 * layer rather than in SQL because "same logical document" is a business match on
 * (folder_id, document_reference), not a DB-enforced identity, and the two writes (insert new row +
 * update the old one) need to happen together after the insert succeeds.
 *
 * Numbering: every upload also runs the numbering engine (lib/numbering/generate.ts, doc_type
 * 'vault_document') to stamp a document_number, plus a hidden internal_reference for white-label
 * organisations. This is the one feature wired to the shared engine today — see that file's header
 * and the module report for how ITP/NCR/checklist/standalone numbering (currently generated inline,
 * each in its own actions.ts) should migrate onto it later.
 */
export async function uploadVaultDocumentCore(
  supabase: SupabaseClient,
  {
    folderId,
    projectId,
    title,
    documentReference: documentReferenceInput,
    revision,
    documentDate,
    notes,
    storagePath,
    fileSize,
    uploadedBy,
    revisesDocumentId,
  }: UploadVaultDocumentCoreParams
): Promise<UploadVaultDocumentState> {
  let documentReference = documentReferenceInput;
  if (!folderId || !projectId || !title || !storagePath) {
    return { error: "Upload failed — a title and file are required." };
  }

  const { data: folderCheck } = await supabase
    .from("vault_folders")
    .select("id")
    .eq("id", folderId)
    .eq("project_id", projectId)
    .maybeSingle<{ id: string }>();
  if (!folderCheck) {
    return { error: "That folder doesn't belong to this project." };
  }
  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found, or you don't have access to it." };
  }

  // The organisation's own limit (default 50 MB, an Admin can change it); never above the 500 MB bucket ceiling.
  const limitMb = await loadVaultUploadLimitMb(project.organization_id);
  if (fileSize && (Number(fileSize) > limitMb * 1024 * 1024 || Number(fileSize) > VAULT_MAX_UPLOAD_BYTES)) {
    return { error: `Upload failed — ${vaultFileTooLargeMessage(Number(fileSize), limitMb)}` };
  }

  let generatedNumber: Awaited<ReturnType<typeof generateDocumentNumber>>;
  try {
    generatedNumber = await generateDocumentNumber(supabase, {
      organizationId: project.organization_id,
      projectId,
      docType: "vault_document",
      projectNumber: project.project_number,
    });
  } catch (err) {
    if (err instanceof NumberingError) return { error: err.message };
    throw err;
  }
  const { documentNumber, internalReference } = generatedNumber;

  let previousLatest: { id: string; status: string; revision?: string } | null = null;
  if (revisesDocumentId) {
    const { data: prev } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, status, revision, document_reference")
      .eq("id", revisesDocumentId)
      .eq("folder_id", folderId)
      .maybeSingle<{ id: string; status: string; revision: string; document_reference: string | null }>();
    if (!prev) return { error: "The document you are revising was not found in this folder." };
    if (prev.status === "superseded") return { error: "That revision has already been superseded - revise the current one instead." };
    previousLatest = prev;
    if (!documentReference) documentReference = prev.document_reference ?? "";
  } else if (documentReference) {
    const { data: existing } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, status, revision")
      .eq("folder_id", folderId)
      .eq("document_reference", documentReference)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ id: string; status: string; revision: string }[]>();
    previousLatest = existing?.[0] ?? null;
  }

  const { data: document, error } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .insert({
      folder_id: folderId,
      title,
      document_reference: documentReference || null,
      // No revision given (batch uploads, or the form's untouched "0" on a new revision): continue
      // from the previous one (A -> B, 2 -> 3), else start at 0.
      revision: resolveUploadRevision(revision ?? "", previousLatest?.revision),
      document_date: documentDate || null,
      storage_path: storagePath,
      file_size: fileSize ? Number(fileSize) : null,
      notes: notes || null,
      document_number: documentNumber,
      internal_reference: internalReference,
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !document) {
    await removeOrphanedVaultObject(supabase, projectId, storagePath);
    return { error: "Could not save the document record. Check you have permission and try again." };
  }

  // A previous revision that is still only "for review" is simply replaced. One that is already
  // APPROVED stays current until this new revision is itself approved (see approveDocumentAction),
  // so evidence links and the download pack never lose their approved copy in the meantime.
  if (previousLatest && previousLatest.status !== "approved") {
    await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .update({ status: "superseded", superseded_by: document.id })
      .eq("id", previousLatest.id);
  }

  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "vault_document",
    entityId: document.id,
    action: "uploaded",
    actorId: uploadedBy,
    summary: `Document "${title}" uploaded (${documentNumber})${previousLatest ? (previousLatest.status === "approved" ? " — new revision of an approved document (the approved one stays current until this is approved)" : " — replaces a prior draft revision") : ""}`,
  });

  // Best-effort: this is what makes the document usable as AI generation input later (see
  // lib/itps/ai-draft-actions.ts) but is never allowed to fail the upload itself — a document
  // stuck at extraction_status 'pending'/'failed' still uploads and displays fine, it just can't
  // be picked as source text for a generation call.
  try {
    // Very large files (up to VAULT_MAX_UPLOAD_MB) are not pulled into server memory for text
    // extraction: they are stored as-is and simply cannot be used as AI source text.
    if (fileSize && Number(fileSize) > VAULT_EXTRACT_MAX_BYTES) {
      await supabase.from(VAULT_DOCUMENTS_TABLE).update({ extraction_status: "unsupported", extraction_error: null }).eq("id", document.id);
      return { error: null, documentNumber, internalReference, documentId: document.id };
    }
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("inspection-evidence")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .update({ extraction_status: "failed", extraction_error: downloadError?.message ?? "Could not read the uploaded file." })
        .eq("id", document.id);
    } else {
      const outcome = await extractTextFromFile(await fileBlob.arrayBuffer(), storagePath);
      await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .update(
          outcome.status === "done"
            ? { extraction_status: "done", extracted_text: outcome.text, extraction_error: null }
            : outcome.status === "failed"
              ? { extraction_status: "failed", extraction_error: outcome.error }
              : { extraction_status: outcome.status, extraction_error: null }
        )
        .eq("id", document.id);
    }
  } catch (err) {
    await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .update({
        extraction_status: "failed",
        extraction_error: err instanceof Error ? err.message : "Unknown extraction error.",
      })
      .eq("id", document.id);
  }

  return { error: null, documentNumber, internalReference, documentId: document.id };
}

/**
 * Records a vault document after the browser has already uploaded the file straight to Storage
 * (see the upload client component) — this action never sees the file bytes, only where they
 * landed. Mirrors the standalone-assignment photo-upload split (browser -> Storage, then a Server
 * Action call to persist the metadata row). Thin wrapper around uploadVaultDocumentCore: this is
 * the session-bound entry point (a real signed-in user, via the normal RLS-scoped server client),
 * used by every in-app upload path (VaultUploadForm). The email-inbound webhook uses the core
 * function directly with a service-role client instead — see that function's own doc comment.
 */
export async function uploadVaultDocumentAction(
  _prev: UploadVaultDocumentState,
  formData: FormData
): Promise<UploadVaultDocumentState> {
  const folderId = String(formData.get("folder_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await uploadVaultDocumentCore(supabase, {
    folderId,
    projectId,
    title: String(formData.get("title") ?? "").trim(),
    documentReference: String(formData.get("document_reference") ?? "").trim(),
    revision: String(formData.get("revision") ?? "").trim(),
    documentDate: String(formData.get("document_date") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim(),
    storagePath: String(formData.get("storage_path") ?? "").trim(),
    fileSize: String(formData.get("file_size") ?? "").trim(),
    uploadedBy: user?.id ?? null,
    revisesDocumentId: String(formData.get("revises_document_id") ?? "").trim() || null,
  });

  if (!result.error) {
    if (result.documentId) await notifyDocumentSubmitted(supabase, result.documentId, user?.id ?? null);
    revalidatePath(`/inspect/vault/${projectId}/${folderId}`);
    revalidatePath("/inspect/vault");
  }

  return result;
}

// approveVaultDocumentAction (the single-click "first permitted person flips it to approved" path)
// moved to lib/vault/multi-approval-actions.ts's approveDocumentAction, which handles both that
// original shape AND an optional configured multi-approver requirement in one action — see that
// file's doc comment.

export type { VaultDocumentRow };

export interface RenameVaultDocumentState {
  error: string | null;
}

/** Renames a document's title (the upload screen promises "renameable after upload"). Only the
 *  person who uploaded it, or JAGS staff, may rename. The file, number and revision never change. */
export async function renameVaultDocumentAction(
  _prev: RenameVaultDocumentState,
  formData: FormData
): Promise<RenameVaultDocumentState> {
  const documentId = String(formData.get("document_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!documentId || !title) return { error: "A title is required." };
  if (title.length > 200) return { error: "Title must be 200 characters or fewer." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const { data: doc } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("id, title, uploaded_by, vault_folders(project_id, projects(organization_id))")
    .eq("id", documentId)
    .maybeSingle<{
      id: string;
      title: string;
      uploaded_by: string | null;
      vault_folders: { project_id: string; projects: { organization_id: string } | null } | null;
    }>();
  if (!doc) return { error: "Document not found, or you don't have access to it." };

  const { data: profile } = await supabase.from("users").select("staff_role").eq("id", user.id).maybeSingle<{ staff_role: string | null }>();
  const isStaff = !!profile?.staff_role;
  if (!isStaff && doc.uploaded_by !== user.id) {
    return { error: "Only the person who uploaded this document, or JAGS staff, can rename it." };
  }

  const { data: updated, error } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .update({ title })
    .eq("id", documentId)
    .select("id");
  if (error || !updated?.length) return { error: "Could not rename the document. Check you have permission and try again." };

  const organizationId = doc.vault_folders?.projects?.organization_id;
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      projectId: doc.vault_folders?.project_id ?? null,
      entityType: "vault_document",
      entityId: documentId,
      action: "renamed",
      actorId: user.id,
      summary: `Document renamed from "${doc.title}" to "${title}"`,
    });
  }

  revalidatePath(`/inspect/vault/${projectId}/document/${documentId}`);
  revalidatePath(`/inspect/vault`);
  return { error: null };
}
