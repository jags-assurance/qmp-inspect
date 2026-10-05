import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { RenameDocumentForm } from "./rename-document-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VAULT_DOCUMENTS_TABLE, VAULT_FOLDERS_TABLE, type VaultFolderRow } from "@/lib/vault/types";
import { DRAWING_MARKUPS_TABLE, type DrawingMarkupRow } from "@/lib/drawing-markups/types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { DrawingMarkupViewer } from "./drawing-markup-viewer";
import { PageGuide } from "@/components/domain/page-guide";

interface DocumentRow {
  id: string;
  folder_id: string;
  title: string;
  document_number: string | null;
  document_reference: string | null;
  revision: string;
  storage_path: string;
}

/**
 * Vault document viewer. Round-table finding: field inspectors reviewing a drawing/plan had no way
 * to mark up WHERE on the drawing something happened — see drawing-markup-viewer.tsx for the
 * pin-drop overlay itself. This page just resolves the document + its folder/project (for the back
 * link and RLS-scoped queries) and the pick-list of NCRs this project's pins can link to.
 */
export async function VaultDocumentView({
  projectId,
  documentId,
  embedded = false,
}: {
  projectId: string;
  documentId: string;
  embedded?: boolean;
}) {
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: document } = await supabase
    .from(VAULT_DOCUMENTS_TABLE)
    .select("id, folder_id, title, document_number, document_reference, revision, storage_path")
    .eq("id", documentId)
    .maybeSingle()
    .returns<DocumentRow | null>();

  if (!document) {
    if (embedded) return <p className="rounded-md bg-off-white px-3 py-4 text-sm text-muted">Document not found.</p>;
    notFound();
  }

  const { data: folder } = await supabase
    .from(VAULT_FOLDERS_TABLE)
    .select("id, project_id, folder_key, name, created_at")
    .eq("id", document.folder_id)
    .eq("project_id", projectId)
    .maybeSingle()
    .returns<VaultFolderRow | null>();

  if (!folder) {
    if (embedded) return <p className="rounded-md bg-off-white px-3 py-4 text-sm text-muted">Document not found.</p>;
    notFound();
  }

  const { data: markups } = await supabase
    .from(DRAWING_MARKUPS_TABLE)
    .select("id, project_id, vault_document_id, x, y, markup_type, linked_entity_id, label, created_by, created_at")
    .eq("vault_document_id", documentId)
    .order("created_at", { ascending: true })
    .returns<DrawingMarkupRow[]>();

  const { data: ncrs } = await supabase
    .from(NCRS_TABLE)
    .select("id, ncr_number, description")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .returns<{ id: string; ncr_number: string; description: string }[]>();

  const Heading = embedded ? "h2" : "h1";

  return (
    <div>
      <RealtimeRefresh table="drawing_markups" filter={`vault_document_id=eq.${documentId}`} />
      {!embedded && (
        <Link href={`/inspect/vault/${projectId}/${folder.id}`} className="text-sm text-burgundy hover:underline">
          ← Back to {folder.name}
        </Link>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-xl font-semibold text-ink sm:text-2xl [overflow-wrap:anywhere]">{document.title}</Heading>
        <RenameDocumentForm projectId={projectId} documentId={documentId} title={document.title} />
        <PageGuide
          title="Document viewer — how this works"
          points={[
            "Drop a pin anywhere on the drawing to mark where something happened on site — a way to record location, not just a text description.",
            "A pin can optionally link to an existing NCR on this project, tying the markup directly to the non-conformance it documents.",
            "Pins appear live for everyone viewing this document — added by one person, visible to the others without a refresh.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        {document.document_number ?? "—"} · Rev. {document.revision}
        {document.document_reference && (
          <>
            {" · "}
            <Link href={`/inspect/vault/${projectId}/document/${documentId}/compare`} className="text-burgundy hover:underline">
              Compare revisions →
            </Link>
          </>
        )}
      </p>

      <div className="mt-6">
        <DrawingMarkupViewer
          projectId={projectId}
          documentId={documentId}
          storagePath={document.storage_path}
          markups={markups ?? []}
          ncrOptions={(ncrs ?? []).map((n) => ({ id: n.id, label: `${n.ncr_number} — ${n.description}` }))}
        />
      </div>
    </div>
  );
}
