"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

export interface ItpRow {
  id: string;
  itp_number: string;
  title: string;
  status: string;
  revision: number;
  projects: { name: string } | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

const COLUMNS: DataTableColumn<ItpRow>[] = [
  {
    key: "itp_number",
    header: "ITP No.",
    render: (row) => (
      <Link href={`/inspect/itps/${row.id}`} className="doc-id text-burgundy hover:underline">
        {row.itp_number}
      </Link>
    ),
  },
  { key: "title", header: "Title", render: (row) => row.title },
  { key: "project", header: "Project", render: (row) => row.projects?.name ?? "—" },
  { key: "revision", header: "Rev", render: (row) => row.revision },
  {
    key: "status",
    header: "Status",
    render: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>,
  },
];

export function ItpsTable({ rows }: { rows: ItpRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search ITPs…"
      searchKeys={(row) => `${row.itp_number} ${row.title}`}
      emptyMessage="No ITPs yet."
    />
  );
}
