"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PUNCH_LIST_SOURCE_LABELS, type PunchListSource, type PunchListStatus } from "@/lib/punch-list/types";
import { ClosePunchItemForm } from "./close-punch-item-form";

export interface PunchListItemDisplayRow {
  id: string;
  description: string;
  source: PunchListSource;
  location: string | null;
  due_date: string | null;
  status: PunchListStatus;
  project_parties: { name: string } | null;
}

const STATUS_TONE: Record<PunchListStatus, "success" | "neutral"> = {
  open: "neutral",
  closed: "success",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/NcrsTable.
export function PunchListTable({ projectId, rows }: { projectId: string; rows: PunchListItemDisplayRow[] }) {
  const columns: DataTableColumn<PunchListItemDisplayRow>[] = [
    { key: "description", header: "Description", render: (row) => row.description },
    {
      key: "source",
      header: "Source",
      render: (row) => <Badge tone="neutral">{PUNCH_LIST_SOURCE_LABELS[row.source]}</Badge>,
    },
    { key: "location", header: "Location", render: (row) => row.location ?? "—" },
    {
      key: "responsible_party",
      header: "Responsible party",
      render: (row) => row.project_parties?.name ?? "—",
    },
    {
      key: "due_date",
      header: "Due",
      render: (row) => (row.due_date ? new Date(row.due_date).toLocaleDateString() : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        row.status === "open" ? <ClosePunchItemForm projectId={projectId} punchItemId={row.id} /> : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search punch list…"
      searchKeys={(row) => `${row.description} ${row.location ?? ""} ${row.project_parties?.name ?? ""}`}
      emptyMessage="No punch list items yet."
    />
  );
}
