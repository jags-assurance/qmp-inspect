"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

export interface MasterTemplateRow {
  id: string;
  title: string;
  industry: string;
  version: number;
  is_active: boolean;
  master_disciplines: { name: string } | null;
}

const COLUMNS: DataTableColumn<MasterTemplateRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => (
      <Link href={`/inspect/itp-master/${row.id}`} className="font-medium text-burgundy hover:underline">
        {row.title}
      </Link>
    ),
  },
  { key: "industry", header: "Industry", render: (row) => row.industry || "—" },
  { key: "discipline", header: "Discipline", render: (row) => row.master_disciplines?.name ?? "—" },
  { key: "version", header: "Version", render: (row) => `v${row.version}` },
  {
    key: "is_active",
    header: "Status",
    render: (row) => <Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

// Server Component -> Client Component boundary: the page only ever passes plain row data down;
// the column config (which contains render functions) is defined here, already inside client code
// — same pattern as apps/web/app/inspect/projects/projects-table.tsx.
export function TemplatesTable({ rows }: { rows: MasterTemplateRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search master templates…"
      searchKeys={(row) => `${row.title} ${row.industry} ${row.master_disciplines?.name ?? ""}`}
      emptyMessage="No master templates yet. Approve a proposal to add the first one."
    />
  );
}
