"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

export interface ProjectRow {
  id: string;
  project_number: string;
  name: string;
  site_location: string | null;
  status: string;
  organizations: { name: string } | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  on_hold: "warning",
  completed: "neutral",
  cancelled: "danger",
};

const COLUMNS: DataTableColumn<ProjectRow>[] = [
  {
    key: "project_number",
    header: "Project No.",
    render: (row) => <span className="doc-id text-ink">{row.project_number}</span>,
  },
  { key: "name", header: "Name", render: (row) => row.name },
  { key: "organization", header: "Client", render: (row) => row.organizations?.name ?? "—" },
  { key: "site_location", header: "Location", render: (row) => row.site_location ?? "—" },
  {
    key: "status",
    header: "Status",
    render: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge>,
  },
];

// Functions (render/searchKeys) can't cross the server -> client boundary as props from a Server
// Component — this wrapper exists so the Server Component page only ever passes plain, serializable
// row data down, and the column/search config (which contains functions) is defined here, already
// inside client code.
export function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search projects…"
      searchKeys={(row) => `${row.project_number} ${row.name} ${row.site_location ?? ""}`}
      emptyMessage="No projects yet."
    />
  );
}
