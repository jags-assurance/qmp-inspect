"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

export interface LibraryTemplateRow {
  id: string;
  title: string;
  description: string | null;
  discipline_id: string | null;
  master_disciplines: { name: string } | null;
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
