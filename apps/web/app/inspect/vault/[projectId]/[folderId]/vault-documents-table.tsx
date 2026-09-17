"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

export interface VaultDocumentTableRow {
  id: string;
  project_id: string;
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

const COLUMNS: DataTableColumn<VaultDocumentTableRow>[] = [
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

// Server Component -> Client Component boundary: only plain row data crosses; columns (which
// contain render functions) are defined here, inside client code — same pattern as
// apps/web/app/inspect/projects/projects-table.tsx.
export function VaultDocumentsTable({ rows }: { rows: VaultDocumentTableRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search documents…"
      searchKeys={(row) => `${row.document_number ?? ""} ${row.document_reference ?? ""} ${row.title}`}
      emptyMessage="No documents in this folder yet."
    />
  );
}
