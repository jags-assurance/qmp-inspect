import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/rbac/permissions";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE } from "@/lib/vault/types";
import { VAULT_DOCUMENT_APPROVERS_TABLE } from "@/lib/vault/approval-types";
import { vaultDocKind, vaultFileType } from "@/lib/vault/doc-kind";
import { VaultDocumentsTable, type VaultDocumentTableRow } from "../[folderId]/vault-documents-table";
import { T } from "@/components/domain/t";

interface PendingDoc {
  id: string;
  folder_id: string;
  title: string;
  document_number: string | null;
  document_reference: string | null;
  revision: string;
  document_date: string | null;
  status: string;
  created_at: string;
  storage_path: string;
  users: { full_name: string } | null;
}

/** Project-wide queue of documents waiting for the signed-in user to approve or reject. */
export default async function VaultPendingApprovalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await requireSession();
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();

  const canApprove = isAdminStaff(session) || (await hasPermission(session.userId, "approve_vault_document", projectId));

  const { data: folders } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id, name")
    .eq("project_id", projectId)
    .returns<{ id: string; name: string }[]>();
  const folderIds = (folders ?? []).map((f) => f.id);
  const folderName = new Map((folders ?? []).map((f) => [f.id, f.name] as const));

  const { data: docs } = folderIds.length
    ? await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, folder_id, title, document_number, document_reference, revision, document_date, status, created_at, storage_path, users!uploaded_by(full_name)")
        .in("folder_id", folderIds)
        .eq("status", "for_review")
        .order("created_at", { ascending: true })
        .returns<PendingDoc[]>()
    : { data: [] as PendingDoc[] };

  const ids = (docs ?? []).map((d) => d.id);
  const { data: approverRows } = ids.length
    ? await supabase
        .from(VAULT_DOCUMENT_APPROVERS_TABLE)
        .select("document_id, approver_user_id, status")
        .in("document_id", ids)
        .returns<{ document_id: string; approver_user_id: string; status: string }[]>()
    : { data: [] as { document_id: string; approver_user_id: string; status: string }[] };
  const byDoc = new Map<string, { approver_user_id: string; status: string }[]>();
  for (const a of approverRows ?? []) {
    const list = byDoc.get(a.document_id) ?? [];
    list.push(a);
    byDoc.set(a.document_id, list);
  }

  // Mine = I'm a named approver who hasn't acted, or there is no named list and I hold the permission.
  const rows: VaultDocumentTableRow[] = [];
  for (const d of docs ?? []) {
    const approvers = byDoc.get(d.id);
    const mine = approvers
      ? approvers.some((a) => a.approver_user_id === session.userId && a.status === "pending")
      : canApprove;
    if (!mine) continue;
    rows.push({
      id: d.id,
      project_id: projectId,
      folder_id: d.folder_id,
      title: d.title,
      document_number: d.document_number,
      document_reference: d.document_reference ? `${d.document_reference} · ${folderName.get(d.folder_id) ?? ""}` : (folderName.get(d.folder_id) ?? null),
      revision: d.revision,
      document_date: d.document_date,
      status: d.status,
      created_at: d.created_at,
      uploader_name: d.users?.full_name ?? null,
      kind: vaultDocKind({ storagePath: d.storage_path, title: d.title }),
      fileType: vaultFileType(d.storage_path),
      approverProgress: approvers
        ? [approvers.filter((a) => a.status === "approved").length, approvers.length, true]
        : undefined,
    });
  }

  return (
    <div>
      <Link href={`/inspect/vault?project=${projectId}`} className="text-sm text-burgundy hover:underline">
        <T>← Back to Document Vault</T>
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink"><T>My pending approvals</T></h1>
      <p className="mt-1 text-sm text-muted">
        <T>Waiting for you, oldest first. Rejecting needs a reason.</T>
      </p>
      <div className="mt-6">
        <VaultDocumentsTable rows={rows} canApprove={canApprove} />
      </div>
      {rows.length === 0 && <p className="mt-3 text-sm text-muted"><T>Nothing is waiting for you. You are all caught up.</T></p>}
    </div>
  );
}
