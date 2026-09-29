"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

export interface ProjectRow {
  id: string;
  project_number: string;
  name: string;
  site_location: string | null;
  status: string;
  organization_id: string;
  organizations: { name: string } | null;
  /** round(client_accepted ITPs / total ITPs * 100); null when the project has zero ITPs. */
  itpCompletionPct: number | null;
  /** Count of NCRs on this project with status != 'closed'. */
  openNcrCount: number;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  on_hold: "warning",
  completed: "neutral",
  cancelled: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  draft: "Draft",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const COLUMNS: DataTableColumn<ProjectRow>[] = [
  {
    key: "project_number",
    header: "Project No.",
    render: (row) => (
      <Link href={`/inspect/projects/${row.id}`} className="doc-id text-burgundy hover:underline">
        {row.project_number}
      </Link>
    ),
  },
  {
    key: "name",
    header: "Name",
    render: (row) => (
      <Link href={`/inspect/projects/${row.id}`} className="hover:underline">
        {row.name}
      </Link>
    ),
  },
  { key: "organization", header: "Client", render: (row) => row.organizations?.name ?? "—" },
  { key: "site_location", header: "Location", render: (row) => row.site_location ?? "—" },
  {
    key: "status",
    header: "Status",
    render: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</Badge>,
  },
  {
    key: "itp_completion",
    header: "ITP Completion",
    render: (row) =>
      row.itpCompletionPct === null ? (
        <span className="text-muted">—</span>
      ) : (
        <Badge tone={row.itpCompletionPct === 100 ? "success" : "neutral"}>{row.itpCompletionPct}%</Badge>
      ),
  },
  {
    key: "open_ncrs",
    header: "Open NCRs",
    render: (row) => <Badge tone={row.openNcrCount > 0 ? "danger" : "success"}>{row.openNcrCount}</Badge>,
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
