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
import { Badge } from "@/components/ui/badge";
import { EditMetadataForm } from "./edit-metadata-form";
import { VAULT_DOCUMENT_APPROVERS_TABLE } from "@/lib/vault/approval-types";
import { ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE } from "@/lib/itps/evidence-types";
import { INSPECTION_EVIDENCE_DOCUMENTS_TABLE } from "@/lib/checklists/db-types";
import { AUDIT_LOG_TABLE } from "@/lib/audit/types";

interface DocumentRow {
  id: string;
  folder_id: string;
  title: string;
  document_number: string | null;
  document_reference: string | null;
  revision: string;
  storage_path: string;
  status: string;
  document_date: string | null;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  superseded_by: string | null;
  uploaded_by: string | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  approved: "success",
  for_review: "warning",
  superseded: "neutral",
  rejected: "danger",
};
const STATUS_LABEL: Record<string, string> = { approved: "Approved", for_review: "For review", superseded: "Superseded", rejected: "Rejected" };
const STATUS_EXPLAIN: Record<string, string> = {
  for_review: "Waiting for approval. It is not yet the controlled copy and cannot be linked as evidence.",
  approved: "Approved: this is the controlled copy. It cannot be edited; upload a new revision to change it.",
  superseded: "Superseded by a newer revision. Kept for the record; do not use for work.",
  rejected: "Sent back by a reviewer. Upload a corrected revision with the same reference.",
};

interface RevisionRow {
  id: string;
  revision: string;
  status: string;
  created_at: string;
  title: string;
  notes: string | null;
  users: { full_name: string } | null;
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
    .select("id, folder_id, title, document_number, document_reference, revision, storage_path, status, document_date, notes, rejection_reason, created_at, superseded_by, uploaded_by")
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

  // Revision history: every row sharing this document's reference (or just this one when none).
  const { data: revisionRows } = document.document_reference
    ? await supabase
        .from(VAULT_DOCUMENTS_TABLE)
        .select("id, revision, status, created_at, title, notes, users!uploaded_by(full_name)")
        .eq("folder_id", document.folder_id)
        .eq("document_reference", document.document_reference)
        .order("created_at", { ascending: false })
        .returns<RevisionRow[]>()
    : { data: null as RevisionRow[] | null };
  const revisions = revisionRows ?? [];

  const { data: approverRows } = await supabase
    .from(VAULT_DOCUMENT_APPROVERS_TABLE)
    .select("approver_user_id, status, reviewed_at, users(full_name)")
    .eq("document_id", documentId)
    .returns<{ approver_user_id: string; status: string; reviewed_at: string | null; users: { full_name: string } | null }[]>();

  // Where used: ITP activities, inspections and NCRs that reference this document as evidence.
  const { data: itpLinks } = await supabase
    .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
    .select("itp_items(item_number, activity, itp_sections(itps(id, itp_number)))")
    .eq("vault_document_id", documentId)
    .returns<{ itp_items: { item_number: string; activity: string; itp_sections: { itps: { id: string; itp_number: string } | null } | null } | null }[]>();
  const { data: inspectionLinks } = await supabase
    .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
    .select("inspection_records(id, record_number, activity)")
    .eq("vault_document_id", documentId)
    .returns<{ inspection_records: { id: string; record_number: string; activity: string } | null }[]>();
  const linkedNcrIds = new Set((markups ?? []).filter((m) => m.markup_type === "ncr" && m.linked_entity_id).map((m) => m.linked_entity_id as string));
  const linkedNcrs = (ncrs ?? []).filter((n) => linkedNcrIds.has(n.id));

  const { data: auditRows } = await supabase
    .from(AUDIT_LOG_TABLE)
    .select("id, action, summary, created_at, users:actor_id(full_name)")
    .eq("entity_type", "vault_document")
    .eq("entity_id", documentId)
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<{ id: string; action: string; summary: string; created_at: string; users: { full_name: string } | null }[]>();

  const { data: me } = await supabase.auth.getUser();
  const myId = me.user?.id ?? null;
  const { data: myProfile } = myId
    ? await supabase.from("users").select("staff_role").eq("id", myId).maybeSingle<{ staff_role: string | null }>()
    : { data: null };
  const canEditMeta = !!myProfile?.staff_role || (myId !== null && document.uploaded_by === myId);
  const canRevise = document.status !== "superseded";
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const usedCount = (itpLinks ?? []).length + (inspectionLinks ?? []).length + linkedNcrs.length;

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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge showIcon tone={STATUS_TONE[document.status] ?? "neutral"}>{STATUS_LABEL[document.status] ?? document.status}</Badge>
        <p className="text-sm text-muted">{STATUS_EXPLAIN[document.status]}</p>
      </div>
      {document.status === "rejected" && document.rejection_reason && (
        <p className="mt-2 rounded-md bg-off-white px-3 py-2 text-sm text-ink">Rejection reason: {document.rejection_reason}</p>
      )}
      {(approverRows ?? []).length > 0 && (
        <section className="mt-3" aria-label="Approvers">
          <h3 className="text-sm font-semibold text-ink">
            Required approvers ({(approverRows ?? []).filter((a) => a.status === "approved").length} of {(approverRows ?? []).length} agreed)
          </h3>
          <ul className="mt-1 space-y-0.5 text-sm">
            {(approverRows ?? []).map((a) => (
              <li key={a.approver_user_id} className="flex flex-wrap items-center gap-2">
                <span className="text-ink">{a.users?.full_name ?? "Unknown"}</span>
                <Badge tone={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"}>
                  {a.status === "approved" ? "Agreed" : a.status === "rejected" ? "Rejected" : "Pending"}
                </Badge>
                {a.reviewed_at && <span className="text-xs text-muted">{fmt(a.reviewed_at)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href={`/inspect/vault/${projectId}/${folder.id}?newrev=${documentId}#vault-upload`}
          className={`inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline sm:min-h-0 ${canRevise ? "" : "pointer-events-none opacity-50"}`}
          aria-disabled={!canRevise}
        >
          Upload new revision
        </Link>
        {canEditMeta && (
          <EditMetadataForm
            projectId={projectId}
            documentId={documentId}
            title={document.title}
            reference={document.document_reference ?? ""}
            revision={document.revision}
            documentDate={document.document_date ?? ""}
            notes={document.notes ?? ""}
            locked={document.status === "approved" || document.status === "superseded"}
          />
        )}
      </div>
      {document.notes && <p className="mt-2 text-sm text-muted">Notes: {document.notes}</p>}
      <p className="mt-1 text-xs text-muted">
        Added {fmt(document.created_at)}
        {document.document_date ? ` · Document date ${new Date(document.document_date).toLocaleDateString("en-GB")}` : ""}
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

      <section className="mt-8" aria-label="Revision history">
        <h3 className="text-sm font-semibold text-ink">Revision history</h3>
        {revisions.length <= 1 ? (
          <p className="mt-1 text-sm text-muted">This is the only revision so far.</p>
        ) : (
          <ol className="mt-2 space-y-2 border-l border-border pl-4">
            {revisions.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {r.id === documentId ? (
                    <span className="font-medium text-ink">Rev {r.revision} (viewing)</span>
                  ) : (
                    <Link href={`/inspect/vault/${projectId}/document/${r.id}`} className="font-medium text-burgundy hover:underline">
                      Rev {r.revision}
                    </Link>
                  )}
                  <Badge showIcon tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  <span className="text-xs text-muted">
                    {fmt(r.created_at)}
                    {r.users?.full_name ? ` · ${r.users.full_name}` : ""}
                  </span>
                </div>
                {r.notes && <p className="text-xs text-muted">Change note: {r.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6" aria-label="Where used">
        <h3 className="text-sm font-semibold text-ink">Where used</h3>
        {usedCount === 0 ? (
          <p className="mt-1 text-sm text-muted">Not linked as evidence to any ITP, inspection or NCR yet.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm">
            {(itpLinks ?? []).map((l, i) =>
              l.itp_items?.itp_sections?.itps ? (
                <li key={`itp-${i}`}>
                  ITP{" "}
                  <Link href={`/inspect/itps/${l.itp_items.itp_sections.itps.id}`} className="doc-id text-burgundy hover:underline">
                    {l.itp_items.itp_sections.itps.itp_number}
                  </Link>{" "}
                  · item {l.itp_items.item_number} {l.itp_items.activity}
                </li>
              ) : null
            )}
            {(inspectionLinks ?? []).map((l, i) =>
              l.inspection_records ? (
                <li key={`ins-${i}`}>
                  Inspection{" "}
                  <Link href={`/inspect/inspections/${l.inspection_records.id}`} className="doc-id text-burgundy hover:underline">
                    {l.inspection_records.record_number}
                  </Link>{" "}
                  · {l.inspection_records.activity}
                </li>
              ) : null
            )}
            {linkedNcrs.map((n) => (
              <li key={n.id}>
                NCR{" "}
                <Link href={`/inspect/ncrs/${n.id}`} className="doc-id text-burgundy hover:underline">
                  {n.ncr_number}
                </Link>{" "}
                (drawing pin)
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-label="Audit trail">
        <h3 className="text-sm font-semibold text-ink">Audit trail</h3>
        {(auditRows ?? []).length === 0 ? (
          <p className="mt-1 text-sm text-muted">No recorded events.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border rounded-md border border-border text-sm">
            {(auditRows ?? []).map((a) => (
              <li key={a.id} className="px-3 py-2">
                <span className="text-ink">{a.summary}</span>
                <span className="block text-xs text-muted">
                  {fmt(a.created_at)}
                  {a.users?.full_name ? ` · ${a.users.full_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
