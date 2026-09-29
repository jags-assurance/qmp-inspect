"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { OpenItem } from "@/lib/kpis/compute";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  open: "danger",
  in_progress: "warning",
  pending_verification: "warning",
  fail: "danger",
};

const KIND_LABEL: Record<OpenItem["kind"], string> = {
  ncr: "NCR",
  inspection: "Failed inspection",
};

const COLUMNS: DataTableColumn<OpenItem>[] = [
  {
    key: "kind",
    header: "Type",
    render: (row) => <Badge tone={row.kind === "ncr" ? "neutral" : "danger"}>{KIND_LABEL[row.kind]}</Badge>,
  },
  { key: "reference", header: "Reference", render: (row) => <span className="doc-id text-ink">{row.reference}</span> },
  { key: "description", header: "Description", render: (row) => row.description },
  {
    key: "status",
    header: "Status",
    render: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status.replace(/_/g, " ")}</Badge>,
  },
  {
    key: "createdAt",
    header: "Raised",
    render: (row) => new Date(row.createdAt).toLocaleDateString("en-GB"),
  },
];

// Same server/client split rationale as ProjectsTable (apps/web/app/inspect/projects/projects-table.tsx):
// the KPI page is a Server Component, so column render functions have to live in this client-only
// wrapper rather than be passed down as props.
export function OpenItemsTable({ rows }: { rows: OpenItem[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search open items…"
      searchKeys={(row) => `${row.reference} ${row.description}`}
      emptyMessage="No open NCRs or failed inspections on this project."
    />
  );
}
