"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { approveDocumentAction } from "@/lib/vault/multi-approval-actions";

export interface VaultDuplicateMatch {
  key: string;
  documentId: string;
  title: string;
  revision: string;
  status: string;
  /** True when the SAME revision label already exists (a likely accidental re-upload). */
  sameRevision: boolean;
}

/** Duplicate detection for the upload form: for each (reference, revision) pair, finds the current
 *  (non-superseded) document in the folder with that reference, so the UI can ask "new revision of X?"
 *  before anything is stored. */
export async function checkVaultDuplicatesAction(
  folderId: string,
  items: { key: string; reference: string; revision: string }[]
): Promise<VaultDuplicateMatch[]> {
  await requireSession();
  const refs = Array.from(new Set(items.map((i) => i.reference.trim()).filter(Boolean)));
  if (!folderId || refs.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("id, title, revision, status, document_reference, created_at")
    .eq("folder_id", folderId)
    .in("document_reference", refs)
    .order("created_at", { ascending: false })
    .returns<{ id: string; title: string; revision: string; status: string; document_reference: string }[]>();
  const rows = data ?? [];
  const out: VaultDuplicateMatch[] = [];
  for (const item of items) {
    const ref = item.reference.trim();
    if (!ref) continue;
    const rev = item.revision.trim();
    const sameRev = rev ? rows.find((r) => r.document_reference === ref && r.revision === rev && r.status !== "rejected") : undefined;
    const current = rows.find((r) => r.document_reference === ref && r.status !== "superseded");
    const hit = sameRev ?? current;
    if (hit) {
      out.push({ key: item.key, documentId: hit.id, title: hit.title, revision: hit.revision, status: hit.status, sameRevision: !!sameRev });
    }
  }
  return out;
}

export interface UpdateVaultMetadataState {
  error: string | null;
  saved?: boolean;
}

/** Edits a document's metadata. Title/date/notes are editable by the uploader or JAGS staff;
 *  reference and revision only while the document is not yet approved (the DB trigger enforces the
 *  same rule: a controlled document changes by new revision, never in place). */
export async function updateVaultDocumentMetadataAction(
  _prev: UpdateVaultMetadataState,
  formData: FormData
): Promise<UpdateVaultMetadataState> {
  const documentId = String(formData.get("document_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const reference = String(formData.get("document_reference") ?? "").trim();
  const revision = String(formData.get("revision") ?? "").trim();
  const documentDate = String(formData.get("document_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!documentId || !title) return { error: "A title is required." };
  if (title.length > 200) return { error: "Title must be 200 characters or fewer." };
  if (!revision) return { error: "A revision is required." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const { data: doc } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("id, status, uploaded_by, title, revision, document_reference, vault_folders(project_id, projects(organization_id))")
    .eq("id", documentId)
    .maybeSingle<{
      id: string;
      status: string;
      uploaded_by: string | null;
      title: string;
      revision: string;
      document_reference: string | null;
      vault_folders: { project_id: string; projects: { organization_id: string } | null } | null;
    }>();
  if (!doc) return { error: "Document not found, or you don't have access to it." };

  const { data: profile } = await supabase.from("users").select("staff_role").eq("id", user.id).maybeSingle<{ staff_role: string | null }>();
  if (!profile?.staff_role && doc.uploaded_by !== user.id) {
    return { error: "Only the person who uploaded this document, or JAGS staff, can edit its details." };
  }

  const locked = doc.status === "approved" || doc.status === "superseded";
  const patch: Record<string, unknown> = { title, document_date: documentDate || null, notes: notes || null };
  if (!locked) {
    patch.document_reference = reference || null;
    patch.revision = revision;
  } else if (revision !== doc.revision || (reference || null) !== doc.document_reference) {
    return { error: "Reference and revision can't be changed once a document is approved. Upload a new revision instead." };
  }

  const { data: updated, error } = await supabase.from(VAULT_DOCUMENTS_TABLE).update(patch).eq("id", documentId).select("id");
  if (error || !updated?.length) return { error: "Could not save the changes. Check you have permission and try again." };

  const organizationId = doc.vault_folders?.projects?.organization_id;
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      projectId: doc.vault_folders?.project_id ?? null,
      entityType: "vault_document",
      entityId: documentId,
      action: "metadata_updated",
      actorId: user.id,
      summary: `Document details updated${doc.title !== title ? ` (title "${doc.title}" to "${title}")` : ""}${!locked && revision !== doc.revision ? ` (revision ${doc.revision} to ${revision})` : ""}`,
    });
  }
  revalidatePath(`/inspect/vault/${projectId}/document/${documentId}`);
  revalidatePath(`/inspect/vault`);
  return { error: null, saved: true };
}

export interface BulkApproveState {
  error: string | null;
  approved?: number;
  skipped?: string[];
}

/** Approves several documents in one go. Each goes through the normal approveDocumentAction, so
 *  every per-document rule (named approvers, permission, status) still applies; failures are
 *  reported per document instead of aborting the batch. */
export async function bulkApproveDocumentsAction(
  _prev: BulkApproveState,
  formData: FormData
): Promise<BulkApproveState> {
  await requireSession();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const folderId = String(formData.get("folder_id") ?? "").trim();
  const ids = formData.getAll("document_ids").map((v) => String(v).trim()).filter(Boolean).slice(0, 100);
  if (ids.length === 0) return { error: "Select at least one document to approve." };

  let approved = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const fd = new FormData();
    fd.set("document_id", id);
    fd.set("project_id", projectId);
    fd.set("folder_id", folderId);
    const result = await approveDocumentAction({ error: null }, fd);
    if (result.error) skipped.push(result.error);
    else approved += 1;
  }
  revalidatePath(`/inspect/vault/${projectId}`);
  return { error: null, approved, skipped: Array.from(new Set(skipped)) };
}
