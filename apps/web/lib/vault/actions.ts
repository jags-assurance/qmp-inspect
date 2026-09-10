"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_DOCUMENTS_TABLE, type VaultDocumentRow } from "@/lib/vault/types";
import { generateDocumentNumber } from "@/lib/numbering/generate";

export interface UploadVaultDocumentState {
  error: string | null;
  documentNumber?: string;
  internalReference?: string | null;
}

/**
 * Records a vault document after the browser has already uploaded the file straight to Storage
 * (see the upload client component) — this action never sees the file bytes, only where they
 * landed. Mirrors the standalone-assignment photo-upload split (browser -> Storage, then a Server
 * Action call to persist the metadata row).
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
export async function uploadVaultDocumentAction(
  _prev: UploadVaultDocumentState,
  formData: FormData
): Promise<UploadVaultDocumentState> {
  const folderId = String(formData.get("folder_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const documentReference = String(formData.get("document_reference") ?? "").trim();
  const revision = String(formData.get("revision") ?? "").trim();
  const documentDate = String(formData.get("document_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const storagePath = String(formData.get("storage_path") ?? "").trim();
  const fileSize = String(formData.get("file_size") ?? "").trim();

  if (!folderId || !projectId || !title || !storagePath) {
    return { error: "Upload failed — a title and file are required." };
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
      uploaded_by: user?.id ?? null,
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

  revalidatePath(`/inspect/vault/${projectId}/${folderId}`);
  revalidatePath("/inspect/vault");
  return { error: null, documentNumber, internalReference };
}

export type { VaultDocumentRow };
