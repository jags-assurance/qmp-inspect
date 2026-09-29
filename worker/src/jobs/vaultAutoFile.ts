import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auto-files a worker-rendered PDF (ITP / NCR / Inspection Report, and any future template) into
 * the project's Document Vault, so generated documents are findable alongside manually-uploaded
 * ones (apps/web/lib/vault/*, apps/web/app/inspect/vault/*).
 *
 * Vault folders are the fixed, per-project set auto-created by the `create_default_vault_folders`
 * trigger (supabase/migrations/20260910010000_phase2_document_vault.sql,
 * .../20260917050000_add_test_reports_vault_folder.sql) — this never creates a new category, it
 * only resolves the existing folder_key for this project and inserts a vault_documents row into it.
 *
 * Bucket note: every other vault document's storage_path is implicitly relative to the
 * "inspection-evidence" bucket (see vault_documents_insert's storage.objects policies and
 * drawing-markup-viewer.tsx's hardcoded `.from("inspection-evidence")`). Worker-rendered PDFs live
 * in the separate "generated-documents" bucket instead, so the path stored here is prefixed
 * "generated-documents:<path>" — drawing-markup-viewer.tsx (the vault document viewer) and the
 * vault download-all route both parse that optional "<bucket>:<path>" prefix, defaulting to
 * inspection-evidence when it's absent, so every existing manually-uploaded document keeps working
 * unchanged.
 *
 * Status: 'approved', not 'for_review' — these are JAGS-issued official records (not a client
 * upload awaiting review), same convention as itps.approved_by/ncrs.closed_by elsewhere in this
 * app: an already-controlled document doesn't re-enter a draft review queue just because it landed
 * in the vault too. Failure here is logged and swallowed, never thrown — a vault-filing hiccup
 * must not fail the underlying job the user actually asked for (the PDF itself already
 * rendered/uploaded successfully by the time this runs).
 */
export async function autoFileVaultDocument(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    folderKey: string;
    title: string;
    documentReference: string | null;
    revision: string;
    storagePath: string;
    fileSize: number | null;
  }
): Promise<void> {
  try {
    const { data: folder, error: folderError } = await supabase
      .from("vault_folders" as never)
      .select("id")
      .eq("project_id", params.projectId)
      .eq("folder_key", params.folderKey)
      .maybeSingle<{ id: string }>();

    if (folderError || !folder) {
      console.error(
        `[vaultAutoFile] Could not resolve vault folder '${params.folderKey}' for project ${params.projectId}:`,
        folderError?.message ?? "no folder row"
      );
      return;
    }

    const { error: insertError } = await supabase.from("vault_documents" as never).insert({
      folder_id: folder.id,
      title: params.title,
      document_reference: params.documentReference,
      revision: params.revision,
      storage_path: `generated-documents:${params.storagePath}`,
      file_size: params.fileSize,
      status: "approved",
      uploaded_by: null,
    } as never);

    if (insertError) {
      console.error(`[vaultAutoFile] Failed to insert vault_documents row for '${params.title}':`, insertError.message);
    }
  } catch (err) {
    console.error("[vaultAutoFile] Unexpected error while auto-filing to the vault:", err);
  }
}
