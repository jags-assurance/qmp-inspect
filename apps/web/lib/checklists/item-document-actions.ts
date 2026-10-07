"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { INSPECTION_EVIDENCE_DOCUMENTS_TABLE } from "./db-types";
import { canExecuteItpItem } from "./execution-parties";
import { uploadVaultDocumentCore } from "@/lib/vault/actions";

/**
 * Per-checklist-item documents.
 *
 * Narrow rule (documented exception): the normal "link a Vault file as evidence" action only
 * accepts APPROVED vault documents. A document uploaded through the per-item "+ Document > Upload
 * new" flow below is created by the executing party themselves in the project's "Checklists & Forms"
 * folder and may be linked to the item straight away, even though the vault document starts
 * "for review". The UI shows a "Pending vault approval" chip until it is approved. This applies ONLY
 * to documents created by this action; linking pre-existing vault files still goes through
 * linkInspectionEvidenceDocumentAction (approved only).
 */

const ITEM_DOC_MAX_BYTES = 25 * 1024 * 1024;
const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|mjs|vbs|jar|dll|apk|app|bin|reg|lnk|html?|php|py)$/i;
const ALLOWED = /\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;
const CHECKLISTS_FOLDER_KEY = "checklists_forms";

export interface ItemDocumentState {
  error: string | null;
  done?: boolean;
}

async function loadOpenRecord(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, inspectionRecordId: string) {
  const { data: record } = await supabase
    .from("inspection_records")
    .select("itp_item_id, record_number, project_id, checklist_template_id, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<{
      itp_item_id: string;
      record_number: string;
      project_id: string;
      checklist_template_id: string | null;
      overall_result: string | null;
    }>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can change documents.", record: null };
  }
  if (record.overall_result) return { error: "This inspection is completed — documents can no longer be changed.", record: null };
  return { error: null, record };
}

/** Confirms the uploaded object really exists in Storage and its size/mime are sane; returns the real size or an error. */
async function verifyStorageObject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  storagePath: string
): Promise<{ error: string | null; size?: number }> {
  const slash = storagePath.lastIndexOf("/");
  const dir = storagePath.slice(0, slash);
  const name = storagePath.slice(slash + 1);
  const { data, error } = await supabase.storage.from("inspection-evidence").list(dir, { search: name, limit: 20 });
  if (error) return { error: "Could not verify the uploaded file. Try again." };
  const obj = (data ?? []).find((o) => o.name === name);
  if (!obj) return { error: "The uploaded file was not found in storage — upload it again." };
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = Number(meta.size ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > ITEM_DOC_MAX_BYTES) return { error: "The uploaded file is empty or larger than 25 MB." };
  const mime = String(meta.mimetype ?? "").toLowerCase();
  if (/(html|javascript|x-msdownload|x-sh|php)/.test(mime)) return { error: "This file type isn't allowed." };
  return { error: null, size };
}

async function audit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  entityId: string,
  action: string,
  summary: string
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "inspection_evidence_document",
        entityId,
        action,
        actorId: user?.id ?? null,
        summary,
      });
    }
  } catch {
    // best-effort
  }
}

/** Uploads (already in Storage) a new document into Checklists & Forms and links it to the item. */
export async function uploadItemDocumentAction(input: {
  inspectionRecordId: string;
  checklistItemId: string;
  itemNumber: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
}): Promise<ItemDocumentState> {
  const { inspectionRecordId, checklistItemId, storagePath, fileName } = input;
  if (!inspectionRecordId || !checklistItemId || !storagePath || !fileName) return { error: "Upload failed — missing details." };
  if (BLOCKED.test(fileName) || !ALLOWED.test(fileName)) {
    return { error: "This file type isn't allowed. Use PDF, Word, Excel, CSV, TXT or an image." };
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0 || input.fileSize > ITEM_DOC_MAX_BYTES) {
    return { error: "File must be 25 MB or smaller." };
  }

  const supabase = await createSupabaseServerClient();
  const loaded = await loadOpenRecord(supabase, inspectionRecordId);
  if (!loaded.record) return { error: loaded.error ?? "Not allowed." };
  const { record } = loaded;

  if (!storagePath.startsWith(`vault/${record.project_id}/${CHECKLISTS_FOLDER_KEY}/`) || storagePath.includes("..")) {
    return { error: "Invalid upload location." };
  }
  const verified = await verifyStorageObject(supabase, storagePath);
  if (verified.error) return { error: verified.error };
  const { data: item } = await supabase
    .from("checklist_items")
    .select("id, item_number, template_id")
    .eq("id", checklistItemId)
    .maybeSingle<{ id: string; item_number: string; template_id: string }>();
  if (!item || (record.checklist_template_id && item.template_id !== record.checklist_template_id)) {
    return { error: "That checklist item doesn't belong to this inspection." };
  }

  const { data: folder } = await supabase
    .from("vault_folders")
    .select("id")
    .eq("project_id", record.project_id)
    .eq("folder_key", CHECKLISTS_FOLDER_KEY)
    .maybeSingle<{ id: string }>();
  if (!folder) return { error: "This project has no 'Checklists & Forms' folder in its Document Vault." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const title = `${record.record_number} item ${item.item_number} — ${fileName}`;
  const created = await uploadVaultDocumentCore(supabase, {
    folderId: folder.id,
    projectId: record.project_id,
    title,
    documentReference: "",
    revision: "",
    documentDate: "",
    notes: `Uploaded from checklist item ${item.item_number} of inspection ${record.record_number}.`,
    storagePath,
    fileSize: String(verified.size ?? input.fileSize),
    uploadedBy: user?.id ?? null,
  });
  if (created.error) return { error: created.error };

  const { data: doc } = await supabase
    .from("vault_documents")
    .select("id")
    .eq("storage_path", storagePath)
    .eq("folder_id", folder.id)
    .maybeSingle<{ id: string }>();
  if (!doc) return { error: "The document was saved but could not be linked — link it from the Document Vault." };

  const { error } = await supabase.from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE).upsert(
    [{ inspection_record_id: inspectionRecordId, checklist_item_id: checklistItemId, vault_document_id: doc.id, linked_by: user?.id ?? null }],
    { onConflict: "inspection_record_id,vault_document_id", ignoreDuplicates: true }
  );
  if (error) return { error: "The document was saved but could not be linked to the item." };

  await audit(supabase, record.project_id, inspectionRecordId, "linked", `Document uploaded and linked to item ${item.item_number} of inspection ${record.record_number} (pending vault approval)`);
  if (record.checklist_template_id) revalidatePath(`/inspect/checklists/${record.checklist_template_id}`);
  revalidatePath(`/inspect/vault/${record.project_id}/${folder.id}`);
  return { error: null, done: true };
}

/** Removes one document link from an item (the vault document itself is kept). */
export async function unlinkItemDocumentAction(input: { inspectionRecordId: string; linkId: string }): Promise<ItemDocumentState> {
  const supabase = await createSupabaseServerClient();
  const loaded = await loadOpenRecord(supabase, input.inspectionRecordId);
  if (!loaded.record) return { error: loaded.error ?? "Not allowed." };
  const { record } = loaded;

  const { error } = await supabase
    .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
    .delete()
    .eq("id", input.linkId)
    .eq("inspection_record_id", input.inspectionRecordId);
  if (error) return { error: "Could not remove the document." };

  await audit(supabase, record.project_id, input.inspectionRecordId, "unlinked", `Item document unlinked from inspection ${record.record_number}`);
  if (record.checklist_template_id) revalidatePath(`/inspect/checklists/${record.checklist_template_id}`);
  return { error: null, done: true };
}
