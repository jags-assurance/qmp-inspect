"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { VAULT_DOCUMENTS_TABLE, type VaultDocumentRow } from "@/lib/vault/types";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { extractTextFromFile } from "@/lib/vault/extract-text";

export interface UploadVaultDocumentState {
  error: string | null;
  documentNumber?: string;
  internalReference?: string | null;
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
    documentReference,
    revision,
    documentDate,
    notes,
    storagePath,
    fileSize,
    uploadedBy,
  }: UploadVaultDocumentCoreParams
): Promise<UploadVaultDocumentState> {
  if (!folderId || !projectId || !title || !storagePath) {
    return { error: "Upload failed — a title and file are required." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found, or you don't have access to it." };
  }

  const { documentNumber, internalReference } = await generateDocumentNumber(supabase, {
    organizationId: project.organization_id,
    projectId,
    docType: "vault_document",
    projectNumber: project.project_number,
  });

  let previousLatest: { id: string } | null = null;
  if (documentReference) {
    const { data: existing } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id")
      .eq("folder_id", folderId)
      .eq("document_reference", documentReference)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<{ id: string }[]>();
    previousLatest = existing?.[0] ?? null;
  }

  const { data: document, error } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .insert({
      folder_id: folderId,
      title,
      document_reference: documentReference || null,
      revision: revision || "0",
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
    return { error: "Could not save the document record. Check you have permission and try again." };
  }

  if (previousLatest) {
    await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .update({ status: "superseded", superseded_by: document.id })
      .eq("id", previousLatest.id);
  }

  // Best-effort: this is what makes the document usable as AI generation input later (see
  // lib/itps/ai-draft-actions.ts) but is never allowed to fail the upload itself — a document
  // stuck at extraction_status 'pending'/'failed' still uploads and displays fine, it just can't
  // be picked as source text for a generation call.
  try {
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

  return { error: null, documentNumber, internalReference };
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
  });

  if (!result.error) {
    revalidatePath(`/inspect/vault/${projectId}/${folderId}`);
    revalidatePath("/inspect/vault");
  }

  return result;
}

export interface ApproveVaultDocumentState {
  error: string | null;
}

/**
 * The missing piece: vault_documents.status could always be 'approved' (schema/check constraint),
 * but no action anywhere ever set it there — every upload was stuck at 'for_review' forever. Gated
 * "high authority by default, delegatable per person" — the same model as issue_irn/close_ncr:
 * JAGS Admin always can; anyone else needs the approve_vault_document custom-role permission
 * (deliberately NOT grantable by a self-managed client to its own role — see
 * CLIENT_SELF_SERVICE_PERMISSION_KEYS's doc comment — since a vault document can become the
 * controlled baseline an ITP is later drafted against, the same self-certification concern as an
 * NCR close-out or an IRN release).
 */
export async function approveVaultDocumentAction(
  _prev: ApproveVaultDocumentState,
  formData: FormData
): Promise<ApproveVaultDocumentState> {
  const documentId = String(formData.get("document_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const folderId = String(formData.get("folder_id") ?? "").trim();
  if (!documentId) return { error: "Missing document." };

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "approve_vault_document", projectId || undefined));
  if (!allowed) {
    return { error: "Only a JAGS Admin, or someone granted this permission, can approve a document." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .update({ status: "approved", approved_by: session.userId, approved_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("status", "for_review");

  if (error) return { error: "Could not approve the document. Check you have permission and try again." };

  if (projectId && folderId) revalidatePath(`/inspect/vault/${projectId}/${folderId}`);
  return { error: null };
}

export type { VaultDocumentRow };
