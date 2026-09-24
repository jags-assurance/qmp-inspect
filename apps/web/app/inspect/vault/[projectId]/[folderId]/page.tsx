import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/rbac/permissions";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { VaultDocumentsTable, type VaultDocumentTableRow } from "./vault-documents-table";
import { VaultUploadForm } from "./upload-form";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";

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
  const session = await requireSession();
  const { projectId, folderId } = await params;
  const supabase = await createSupabaseServerClient();

  // High authority by default (JAGS Admin), delegatable per person via the approve_vault_document
  // custom-role permission — see approveVaultDocumentAction's own doc comment for why this stays
  // out of a self-managed client's own grantable subset.
  const canApprove = isAdminStaff(session) || (await hasPermission(session.userId, "approve_vault_document", projectId));

  const { data: folder } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id, project_id, folder_key, name, created_at")
    .eq("id", folderId)
    .eq("project_id", projectId)
    .maybeSingle()
    .returns<VaultFolderRow | null>();

  if (!folder) notFound();

  // Disambiguated FK hint (users!uploaded_by) is now required, not optional — vault_documents grew
  // a second foreign key to users (approved_by, 20260921020000_vault_document_approval.sql), so the
  // previously-unambiguous "users(full_name)" embed now fails at the PostgREST layer ("more than
  // one relationship found"). That error was silently swallowed by `data ?? []` below, which is
  // exactly why every document vanished from this list the moment that migration landed.
  const { data: documents, error: documentsError } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select(
      "id, title, document_number, document_reference, revision, document_date, status, created_at, users!uploaded_by(full_name)"
    )
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false })
    .returns<DocumentWithUploader[]>();

  if (documentsError) {
    console.error("Failed to load vault documents", documentsError);
  }

  const rows: VaultDocumentTableRow[] = (documents ?? []).map((d) => ({
    id: d.id,
    project_id: projectId,
    folder_id: folderId,
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
      <RealtimeRefresh table="vault_documents" filter={`folder_id=eq.${folderId}`} />
      <Link href={`/inspect/vault?project=${projectId}`} className="text-sm text-burgundy hover:underline">
        ← Back to Document Vault
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">{folder.name}</h1>
        <PageGuide
          title="Vault folder — how this works"
          points={[
            "Every revision of a document uploaded to this folder stays visible — a new upload matching an existing document reference marks the old one \"superseded\", it's never deleted or replaced.",
            "New uploads start at status \"for review\". Only a JAGS Admin, or someone specifically granted the approve_vault_document permission for this project, can approve one to make it the controlled baseline.",
            "Uploading is open to anyone with access to this project — approval is the gated step, not the upload itself.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Every revision of a document stays visible here — a new upload of the same reference marks
        the previous one superseded rather than replacing it.
      </p>

      <div className="mt-6">
        <VaultDocumentsTable rows={rows} canApprove={canApprove} />
      </div>

      <VaultUploadForm projectId={projectId} folderId={folderId} folderKey={folder.folder_key} />
    </div>
  );
}
