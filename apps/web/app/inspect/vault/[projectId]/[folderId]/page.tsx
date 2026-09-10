import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { VaultDocumentsTable, type VaultDocumentTableRow } from "./vault-documents-table";
import { VaultUploadForm } from "./upload-form";

interface DocumentWithUploader {
  id: string;
  title: string;
  document_number: string | null;
  document_reference: string | null;
  revision: string;
  document_date: string | null;
  status: string;
  created_at: string;
  users: { full_name: string } | null;
}

export default async function VaultFolderPage({
  params,
}: {
  params: Promise<{ projectId: string; folderId: string }>;
}) {
  await requireSession();
  const { projectId, folderId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: folder } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id, project_id, folder_key, name, created_at")
    .eq("id", folderId)
    .eq("project_id", projectId)
    .maybeSingle()
    .returns<VaultFolderRow | null>();

  if (!folder) notFound();

  const { data: documents } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select(
      "id, title, document_number, document_reference, revision, document_date, status, created_at, users(full_name)"
    )
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false })
    .returns<DocumentWithUploader[]>();

  const rows: VaultDocumentTableRow[] = (documents ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    document_number: d.document_number,
    document_reference: d.document_reference,
    revision: d.revision,
    document_date: d.document_date,
    status: d.status,
    created_at: d.created_at,
    uploader_name: d.users?.full_name ?? null,
  }));

  return (
    <div>
      <Link href={`/inspect/vault?project=${projectId}`} className="text-sm text-burgundy hover:underline">
        ← Back to Document Vault
      </Link>

      <h1 className="mt-2 text-2xl font-semibold text-ink">{folder.name}</h1>
      <p className="mt-1 text-sm text-muted">
        Every revision of a document stays visible here — a new upload of the same reference marks
        the previous one superseded rather than replacing it.
      </p>

      <div className="mt-6">
        <VaultDocumentsTable rows={rows} />
      </div>

      <VaultUploadForm projectId={projectId} folderId={folderId} folderKey={folder.folder_key} />
    </div>
  );
}
