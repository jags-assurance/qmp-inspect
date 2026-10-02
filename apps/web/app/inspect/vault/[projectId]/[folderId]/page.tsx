import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { SetApproversForm } from "./set-approvers-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/rbac/permissions";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { VAULT_DOCUMENT_APPROVERS_TABLE } from "@/lib/vault/approval-types";
import { VaultDocumentsTable, type VaultDocumentTableRow } from "./vault-documents-table";
import { VaultUploadForm } from "./upload-form";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";
import { SplitLayout } from "@/components/ui/split-layout";
import { vaultDocKind, vaultFileType } from "@/lib/vault/doc-kind";
import { VaultDocumentView } from "../document/[documentId]/vault-document-view";

interface DocumentWithUploader {
  id: string;
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

export default async function VaultFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; folderId: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const session = await requireSession();
  const { projectId, folderId } = await params;
  const { doc: selectedDocId } = await searchParams;
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
      "id, title, document_number, document_reference, revision, document_date, status, created_at, storage_path, users!uploaded_by(full_name)"
    )
    .eq("folder_id", folderId)
    .order("created_at", { ascending: false })
    .returns<DocumentWithUploader[]>();

  if (documentsError) {
    console.error("Failed to load vault documents", documentsError);
  }

  const reviewDocIds = (documents ?? []).filter((d) => d.status === "for_review").map((d) => d.id);
  const { data: approverRows } = reviewDocIds.length
    ? await supabase
        .from(VAULT_DOCUMENT_APPROVERS_TABLE)
        .select("document_id, approver_user_id, status")
        .in("document_id", reviewDocIds)
        .returns<{ document_id: string; approver_user_id: string; status: "pending" | "approved" }[]>()
    : { data: [] as { document_id: string; approver_user_id: string; status: "pending" | "approved" }[] };

  const approversByDoc = new Map<string, { document_id: string; approver_user_id: string; status: "pending" | "approved" }[]>();
  for (const row of approverRows ?? []) {
    const list = approversByDoc.get(row.document_id) ?? [];
    list.push(row);
    approversByDoc.set(row.document_id, list);
  }

  const rows: VaultDocumentTableRow[] = (documents ?? []).map((d) => {
    const approvers = approversByDoc.get(d.id);
    return {
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
      kind: vaultDocKind({ storagePath: d.storage_path, title: d.title }),
      fileType: vaultFileType(d.storage_path),
      approverProgress: approvers
        ? [
            approvers.filter((a) => a.status === "approved").length,
            approvers.length,
            // Real gap found in a transactional-integrity audit: if every approver row is
            // 'approved' but the document itself never flipped (the finalization write failed
            // after the last row was recorded), the named approver's own row already reads
            // 'approved' too — without this, their button would vanish with no way to retry the
            // stuck finalization. Keep it visible for them specifically in exactly that state.
            approvers.some(
              (a) =>
                a.approver_user_id === session.userId &&
                (a.status === "pending" || approvers.every((x) => x.status === "approved"))
            ),
          ]
        : undefined,
    };
  });

  let approverOptions: { id: string; name: string }[] = [];
  if (isAdminStaff(session)) {
    const { data: parties } = await supabase
      .from("project_parties")
      .select("user_id, name, users(full_name)")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .not("user_id", "is", null)
      .returns<{ user_id: string; name: string; users: { full_name: string } | null }[]>();

    const { data: staffUsers } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("is_jags_staff", true)
      .order("full_name")
      .returns<{ id: string; full_name: string }[]>();

    const seen = new Set<string>();
    for (const p of parties ?? []) {
      if (!p.user_id || seen.has(p.user_id)) continue;
      seen.add(p.user_id);
      approverOptions.push({ id: p.user_id, name: `${p.users?.full_name ?? "Unknown"} (${p.name})` });
    }
    for (const s of staffUsers ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      approverOptions.push({ id: s.id, name: `${s.full_name} (JAGS)` });
    }
  }

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

      {/* Master-detail: with ?doc= the document viewer opens beside the list (desktop/tablet) or in
          place of it (phone, with a way back) — no navigation to a separate viewer page. */}
      <SplitLayout
        storageKey="vault-folder"
        showDetail={!!selectedDocId}
        defaultListWidth={460}
        list={
          <>
          <div className="mt-6">
            <VaultDocumentsTable rows={rows} canApprove={canApprove} />
          </div>

          <VaultUploadForm projectId={projectId} folderId={folderId} folderKey={folder.folder_key} />

          {isAdminStaff(session) && reviewDocIds.length > 0 && (
            <SetApproversForm
              documentOptions={(documents ?? [])
                .filter((d) => d.status === "for_review")
                .map((d) => ({
                  id: d.id,
                  label: `${d.document_number ?? d.title} — Rev. ${d.revision}`,
                  currentApproverIds: (approversByDoc.get(d.id) ?? []).map((a) => a.approver_user_id),
                }))}
              approverOptions={approverOptions}
            />
          )}
          </>
        }
        detail={
          selectedDocId ? (
          <section className="min-w-0 rounded-lg border border-border bg-surface p-3 sm:p-4" aria-label="Document preview">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/inspect/vault/${projectId}/${folderId}`}
                scroll={false}
                className="inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline lg:hidden"
              >
                ← Back to documents
              </Link>
              <Link
                href={`/inspect/vault/${projectId}/${folderId}`}
                scroll={false}
                className="hidden min-h-11 items-center text-sm text-muted hover:text-ink lg:inline-flex"
              >
                ✕ Close preview
              </Link>
              <Link
                href={`/inspect/vault/${projectId}/document/${selectedDocId}`}
                className="inline-flex min-h-11 items-center text-sm text-burgundy hover:underline"
              >
                Open full page →
              </Link>
            </div>
            <Suspense key={selectedDocId} fallback={<div className="mt-4 h-64 animate-pulse rounded-md bg-off-white" aria-busy="true" />}>
              <VaultDocumentView projectId={projectId} documentId={selectedDocId} embedded />
            </Suspense>
          </section>
          ) : null
        }
      />
    </div>
  );
}
