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
  openPunchCount: number;
  /** Overdue hold points on this project (overdue_hold_points() RPC, aggregated by project). */
  overdueHoldCount: number;
  end_date: string | null;
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
      <Link prefetch={false} href={`/inspect/projects/${row.id}`} className="doc-id text-burgundy hover:underline">
        {row.project_number}
      </Link>
    ),
  },
  {
    key: "name",
    header: "Name",
    render: (row) => (
      <Link prefetch={false} href={`/inspect/projects/${row.id}`} className="hover:underline">
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
    render: (row) => (
      <Link prefetch={false} href={`/inspect/projects/${row.id}?tab=ncrs`}>
        <Badge tone={row.openNcrCount > 0 ? "danger" : "success"}>{row.openNcrCount}</Badge>
      </Link>
    ),
  },
  {
    key: "open_punch",
    header: "Open punch",
    render: (row) => (
      <Link prefetch={false} href={`/inspect/projects/${row.id}?tab=punch-list`}>
        <Badge tone={row.openPunchCount > 0 ? "warning" : "success"}>{row.openPunchCount}</Badge>
      </Link>
    ),
  },
  {
    key: "overdue_holds",
    header: "Overdue holds",
    render: (row) => <Badge tone={row.overdueHoldCount > 0 ? "danger" : "success"}>{row.overdueHoldCount}</Badge>,
  },
  { key: "end_date", header: "Target end", render: (row) => row.end_date ?? "—" },
];

// Functions (render/searchKeys) can't cross the server -> client boundary as props from a Server
// Component — this wrapper exists so the Server Component page only ever passes plain, serializable
// row data down, and the column/search config (which contains functions) is defined here, already
// inside client code.
export function ProjectsTable({ rows, canCreate = false }: { rows: ProjectRow[]; canCreate?: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted">No projects to show.</p>
        {canCreate && (
          <Link href="/inspect/projects/new" className="mt-3 inline-flex min-h-11 items-center rounded-md bg-burgundy px-4 text-sm font-medium text-white">
            Create project
          </Link>
        )}
      </div>
    );
  }
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search projects…"
      searchKeys={(row) => `${row.project_number} ${row.name} ${row.site_location ?? ""} ${row.organizations?.name ?? ""} ${row.status}`}
      emptyMessage="No projects yet."
    />
  );
}
