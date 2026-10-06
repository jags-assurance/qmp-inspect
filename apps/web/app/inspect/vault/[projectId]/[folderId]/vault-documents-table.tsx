"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ApproveDocumentButton } from "./approve-document-button";
import { RejectDocumentButton } from "./reject-document-button";
import { bulkApproveDocumentsAction, type BulkApproveState } from "@/lib/vault/document-control-actions";
import type { VaultDocKind, VaultFileType } from "@/lib/vault/doc-kind";

export interface VaultDocumentTableRow {
  id: string;
  project_id: string;
  folder_id: string;
  title: string;
  document_number: string | null;
  document_reference: string | null;
  revision: string;
  document_date: string | null;
  status: string;
  rejection_reason?: string | null;
  created_at: string;
  uploader_name: string | null;
  /** What the document is (generated ITP/NCR/inspection report vs. an upload) and its file type — both colour-coded. */
  kind: VaultDocKind;
  fileType: VaultFileType;
  /** Set only when this document has a configured multi-approver requirement — [approvedCount,
   *  totalCount, amIAPendingApprover]. Undefined means "no requirement configured", the plain
   *  single-click approval path. */
  approverProgress?: [number, number, boolean];
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  approved: "success",
  for_review: "warning",
  superseded: "neutral",
  rejected: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  for_review: "For review",
  superseded: "Superseded",
  rejected: "Rejected",
};

const FILE_ICON: Record<string, string> = { pdf: "PDF", photo: "IMG", other: "DOC" };

type SortKey = "newest" | "oldest" | "number" | "title" | "status";

const initialBulk: BulkApproveState = { error: null };

function canActOn(row: VaultDocumentTableRow, canApprove: boolean): boolean {
  if (row.status !== "for_review") return false;
  return canApprove || (row.approverProgress ? row.approverProgress[2] : false);
}

export function VaultDocumentsTable({ rows, canApprove }: { rows: VaultDocumentTableRow[]; canApprove: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [uploader, setUploader] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkApproveDocumentsAction, initialBulk);

  const uploaders = useMemo(
    () => Array.from(new Set(rows.map((r) => r.uploader_name).filter((n): n is string => !!n))).sort(),
    [rows]
  );
  const supersededCount = rows.filter((r) => r.status === "superseded").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (!showSuperseded && r.status === "superseded" && status !== "superseded") return false;
      if (status && r.status !== status) return false;
      if (type && r.fileType.key !== type && r.kind.key !== type) return false;
      if (uploader && r.uploader_name !== uploader) return false;
      const d = (r.document_date ?? r.created_at).slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (q && !`${r.document_number ?? ""} ${r.document_reference ?? ""} ${r.title}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "number":
          return (a.document_number ?? "").localeCompare(b.document_number ?? "", undefined, { numeric: true });
        case "title":
          return a.title.localeCompare(b.title);
        case "status":
          return a.status.localeCompare(b.status) || b.created_at.localeCompare(a.created_at);
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return list;
  }, [rows, query, status, type, uploader, from, to, sort, showSuperseded]);

  const selectedRows = visible.filter((r) => selected.has(r.id));
  const selectedApprovable = selectedRows.filter((r) => canActOn(r, canApprove));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const projectId = rows[0]?.project_id;
  const folderId = rows[0]?.folder_id;
  const filtersActive = !!(query || status || type || uploader || from || to);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((r) => r.id)));
  }
  function clearFilters() {
    setQuery("");
    setStatus("");
    setType("");
    setUploader("");
    setFrom("");
    setTo("");
  }

  const fieldCls = "min-h-11 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy sm:min-h-0";

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search number, reference, title…"
            aria-label="Search documents"
            className={`${fieldCls} w-full sm:max-w-xs`}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={fieldCls}>
            <option value="">All statuses</option>
            <option value="for_review">For review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="superseded">Superseded</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type" className={fieldCls}>
            <option value="">All types</option>
            <option value="pdf">PDF</option>
            <option value="photo">Photo / image</option>
            <option value="other">Office / other files</option>
            <option value="upload">Uploaded</option>
            <option value="inspection_report">Inspection reports</option>
            <option value="itp">ITPs</option>
            <option value="ncr">NCRs</option>
            <option value="ncr_closeout">NCR close-outs</option>
          </select>
          <select value={uploader} onChange={(e) => setUploader(e.target.value)} aria-label="Filter by uploader" className={fieldCls}>
            <option value="">Anyone</option>
            {uploaders.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort documents" className={fieldCls}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="number">Document no.</option>
            <option value="title">Title A-Z</option>
            <option value="status">Status</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <label className="inline-flex items-center gap-1">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldCls} />
          </label>
          <label className="inline-flex items-center gap-1">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldCls} />
          </label>
          <label className="inline-flex min-h-11 items-center gap-1.5 sm:min-h-0">
            <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} />
            Show superseded{supersededCount > 0 ? ` (${supersededCount})` : ""}
          </label>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="text-burgundy hover:underline">
              Clear filters
            </button>
          )}
          <span className="ml-auto" aria-live="polite">
            {visible.length} of {rows.length} document{rows.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {selectedRows.length > 0 && projectId && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-off-white px-3 py-2 text-sm"
        >
          <span className="font-medium text-ink">{selectedRows.length} selected</span>
          <a
            href={`/api/vault/${projectId}/download-all?ids=${selectedRows.map((r) => r.id).join(",")}`}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink hover:border-burgundy sm:min-h-0 sm:py-1.5"
          >
            Download selected (.zip)
          </a>
          {selectedApprovable.length > 0 && (
            <form action={bulkAction} className="inline-flex">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="folder_id" value={folderId} />
              {selectedApprovable.map((r) => (
                <input key={r.id} type="hidden" name="document_ids" value={r.id} />
              ))}
              <button
                type="submit"
                disabled={bulkPending}
                className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-ink hover:border-burgundy disabled:opacity-50 sm:min-h-0 sm:py-1.5"
              >
                {bulkPending ? "Approving…" : `Approve ${selectedApprovable.length} for review`}
              </button>
            </form>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted hover:underline">
            Clear selection
          </button>
          {bulkState.approved !== undefined && (
            <span className="text-xs text-muted" role="status">
              Approved {bulkState.approved}
              {bulkState.skipped && bulkState.skipped.length > 0 ? `; not approved: ${bulkState.skipped.join(" / ")}` : ""}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all shown documents" className="size-4" />
              </th>
              <th className="px-3 py-2 font-medium">Document</th>
              <th className="px-3 py-2 font-medium">Rev.</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Dated</th>
              <th className="px-3 py-2 font-medium">Added by</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const named = row.approverProgress ? row.approverProgress[2] : false;
              return (
                <tr key={row.id} className={`border-b border-border last:border-0 hover:bg-off-white ${row.status === "superseded" ? "opacity-70" : ""}`}>
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.title}`}
                      className="mt-1 size-4"
                    />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex h-8 w-9 shrink-0 items-center justify-center rounded border border-border bg-off-white text-[10px] font-semibold text-muted"
                      >
                        {FILE_ICON[row.fileType.key] ?? "DOC"}
                      </span>
                      <div className="min-w-0">
                        <Link
                          prefetch={false}
                          href={`/inspect/vault/${row.project_id}/${row.folder_id}?doc=${row.id}`}
                          scroll={false}
                          className="inline-flex min-h-11 items-center text-burgundy hover:underline sm:min-h-0 [overflow-wrap:anywhere]"
                        >
                          {row.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                          <span className="doc-id text-ink">{row.document_number ?? "—"}</span>
                          {row.document_reference && <span>Ref {row.document_reference}</span>}
                          <Badge tone={row.kind.tone}>{row.kind.label}</Badge>
                          <Badge tone={row.fileType.tone}>{row.fileType.label}</Badge>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="doc-id text-ink">Rev {row.revision}</span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-col items-start gap-1">
                      <Badge showIcon tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
                      {row.status === "rejected" && row.rejection_reason && (
                        <span className="max-w-48 text-xs text-muted" title={row.rejection_reason}>
                          {row.rejection_reason.length > 60 ? `${row.rejection_reason.slice(0, 60)}…` : row.rejection_reason}
                        </span>
                      )}
                      {row.approverProgress && row.status === "for_review" && (
                        <span className="text-xs text-muted" title="Named approvers required for this document">
                          {row.approverProgress[0]}/{row.approverProgress[1]} approvers agreed{named ? " (you are one)" : ""}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-xs text-muted">
                    <div>{row.document_date ? new Date(row.document_date).toLocaleDateString("en-GB") : "—"}</div>
                    <div>added {new Date(row.created_at).toLocaleDateString("en-GB")}</div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="text-ink">{row.uploader_name ?? (row.kind.generated ? "System" : "—")}</span>
                    <span className="block text-xs text-muted">{row.kind.generated ? "Generated" : "Uploaded"}</span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    {canActOn(row, canApprove) && (
                      <span className="flex flex-wrap items-center gap-2">
                        <ApproveDocumentButton
                          documentId={row.id}
                          projectId={row.project_id}
                          folderId={row.folder_id}
                          canApproveGenerally={canApprove}
                          label={row.approverProgress ? "Agree" : "Approve"}
                        />
                        <RejectDocumentButton documentId={row.id} projectId={row.project_id} folderId={row.folder_id} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                  {rows.length === 0
                    ? "No documents in this folder yet. Use the upload form below, or drag files onto it."
                    : filtersActive
                      ? "No documents match these filters."
                      : "Only superseded documents are in this folder. Tick 'Show superseded' to see them."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
