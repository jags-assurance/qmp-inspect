import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { RevisionCompare, type CompareRevisionRow } from "./revision-compare";
import { PageGuide } from "@/components/domain/page-guide";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

interface DocumentRow {
  id: string;
  folder_id: string;
  title: string;
  document_number: string | null;
  document_reference: string | null;
  revision: string;
}

interface RevisionRow {
  id: string;
  title: string;
  document_number: string | null;
  revision: string;
  status: string;
  document_date: string | null;
  notes: string | null;
  storage_path: string;
  created_at: string;
  users: { full_name: string } | null;
}

/**
 * Net-new feature (plan Phase 6) — today's vault has no way to compare two revisions of the same
 * document side by side; a viewer had to open each one separately in its own tab and hold the
 * difference in their head. This groups every revision that shares the current document's
 * `document_reference` (the same "superseded, never deleted" chain vault-documents-table.tsx
 * already documents) and lets two of them be picked and shown side by side. It does not introduce a
 * new revision model — it reads the existing superseded/document_reference chain as-is.
 */
export default async function VaultRevisionComparePage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const tl = await getTranslator();
  await requireSession();
  const { projectId, documentId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: document } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("id, folder_id, title, document_number, document_reference, revision")
    .eq("id", documentId)
    .maybeSingle()
    .returns<DocumentRow | null>();

  if (!document) notFound();

  const { data: folder } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id, project_id, folder_key, name, created_at")
    .eq("id", document.folder_id)
    .eq("project_id", projectId)
    .maybeSingle()
    .returns<VaultFolderRow | null>();

  if (!folder) notFound();

  const { data: revisionRows } = document.document_reference
    ? await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select(
          "id, title, document_number, revision, status, document_date, notes, storage_path, created_at, users!uploaded_by(full_name)"
        )
        .eq("folder_id", document.folder_id)
        .eq("document_reference", document.document_reference)
        .order("created_at", { ascending: true })
        .returns<RevisionRow[]>()
    : { data: [] as RevisionRow[] };

  // Manually uploaded files live in "inspection-evidence" with a bare path; worker auto-filed PDFs
  // are stored as "generated-documents:<path>" in a separate bucket.
  const GENERATED_PREFIX = "generated-documents:";
  const allPaths = (revisionRows ?? []).map((r) => r.storage_path);
  const uploadedUrls = await getSignedPhotoUrls(
    supabase,
    "inspection-evidence",
    allPaths.filter((p) => !p.startsWith(GENERATED_PREFIX))
  );
  const generatedUrls = await getSignedPhotoUrls(
    supabase,
    "generated-documents",
    allPaths.filter((p) => p.startsWith(GENERATED_PREFIX)).map((p) => p.slice(GENERATED_PREFIX.length))
  );
  const signedUrls = {
    get: (p: string) => (p.startsWith(GENERATED_PREFIX) ? generatedUrls.get(p.slice(GENERATED_PREFIX.length)) : uploadedUrls.get(p)),
  };

  const revisions: CompareRevisionRow[] = (revisionRows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    documentNumber: r.document_number,
    revision: r.revision,
    status: r.status,
    documentDate: r.document_date,
    notes: r.notes,
    createdAt: r.created_at,
    uploaderName: r.users?.full_name ?? null,
    url: signedUrls.get(r.storage_path) ?? null,
  }));

  return (
    <div>
      <Link href={`/inspect/vault/${projectId}/document/${documentId}`} className="text-sm text-burgundy hover:underline">
        <T>← Back to</T> {document.title}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink"><T>Compare revisions</T></h1>
        <PageGuide
          title={tl("Compare revisions — how this works")}
          points={[
            "Groups every revision that shares this document's revision key (document_reference) — the same superseded-not-overwritten chain the vault folder page already tracks, not a new revision model.",
            "A document uploaded without a revision key has no siblings to compare against — pick one from the folder's revision-key column instead, or supersede it with a new upload first.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        {document.document_number ?? document.title} · {revisions.length} <T>revision</T>{revisions.length === 1 ? "" : "s"} <T>on record</T>
      </p>

      <div className="mt-6">
        <RevisionCompare revisions={revisions} initialRightId={document.id} />
      </div>
    </div>
  );
}
