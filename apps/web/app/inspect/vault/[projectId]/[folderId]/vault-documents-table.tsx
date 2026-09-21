"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { ApproveDocumentButton } from "./approve-document-button";

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
  created_at: string;
  uploader_name: string | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  approved: "success",
  for_review: "warning",
  superseded: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  for_review: "For review",
  superseded: "Superseded",
};

function buildColumns(canApprove: boolean): DataTableColumn<VaultDocumentTableRow>[] {
  const columns: DataTableColumn<VaultDocumentTableRow>[] = [
    {
      key: "document_number",
      header: "Document No.",
      render: (row) => <span className="doc-id text-ink">{row.document_number ?? "—"}</span>,
    },
    {
      key: "title",
      header: "Title",
      render: (row) => (
        <Link href={`/inspect/vault/${row.project_id}/document/${row.id}`} className="text-burgundy hover:underline">
          {row.title}
        </Link>
      ),
    },
    { key: "revision", header: "Rev.", render: (row) => row.revision },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>,
    },
    {
      key: "document_date",
      header: "Doc. date",
      render: (row) => (row.document_date ? new Date(row.document_date).toLocaleDateString() : "—"),
    },
    {
      key: "created_at",
      header: "Uploaded",
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    { key: "uploader_name", header: "Uploaded by", render: (row) => row.uploader_name ?? "—" },
  ];

  if (canApprove) {
    columns.push({
      key: "actions",
      header: "",
      render: (row) =>
        row.status === "for_review" ? (
          <ApproveDocumentButton documentId={row.id} projectId={row.project_id} folderId={row.folder_id} />
        ) : null,
    });
  }

  return columns;
}

// Server Component -> Client Component boundary: only plain row data crosses; columns (which
// contain render functions) are defined here, inside client code — same pattern as
// apps/web/app/inspect/projects/projects-table.tsx. canApprove is resolved server-side (JAGS Admin,
// or the approve_vault_document custom-role permission) and passed down as a plain boolean — the
// Approve column only renders at all when at least one row could ever use it.
export function VaultDocumentsTable({ rows, canApprove }: { rows: VaultDocumentTableRow[]; canApprove: boolean }) {
  return (
    <DataTable
      columns={buildColumns(canApprove)}
      rows={rows}
      searchPlaceholder="Search documents…"
      searchKeys={(row) => `${row.document_number ?? ""} ${row.document_reference ?? ""} ${row.title}`}
      emptyMessage="No documents in this folder yet."
    />
  );
}
