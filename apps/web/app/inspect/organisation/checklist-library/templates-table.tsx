"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Tx } from "@/components/domain/tx";

export interface LibraryTemplateRow {
  id: string;
  title: string;
  description: string | null;
  discipline_id: string | null;
  /** R46: null = global/shared, a set value scopes this template to one client organisation. */
  organization_id: string | null;
  master_disciplines: { name: string } | null;
  organizations: { name: string } | null;
  checklist_library_items: { count: number }[];
}

const COLUMNS: DataTableColumn<LibraryTemplateRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => (
      <Link href={`/inspect/organisation/checklist-library/${row.id}`} className="font-medium text-burgundy hover:underline">
        {row.title}
      </Link>
    ),
  },
  { key: "discipline", header: "Discipline", render: (row) => row.master_disciplines?.name ?? "—" },
  {
    key: "client",
    header: "Client",
    render: (row) => row.organizations?.name ?? <span className="text-muted"><Tx>Global</Tx></span>,
  },
  { key: "description", header: "Description", render: (row) => row.description ?? "—" },
  {
    key: "items",
    header: "Items",
    render: (row) => row.checklist_library_items?.[0]?.count ?? 0,
  },
];

export function TemplatesTable({ rows }: { rows: LibraryTemplateRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search checklist templates…"
      searchKeys={(row) => `${row.title} ${row.description ?? ""} ${row.master_disciplines?.name ?? ""}`}
      emptyMessage="No checklist templates yet. Build the first one above."
    />
  );
}
