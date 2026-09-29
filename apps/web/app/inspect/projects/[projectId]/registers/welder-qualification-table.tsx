"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { WelderQualificationStatus } from "@/lib/registers/types";

export interface WelderQualificationDisplayRow {
  id: string;
  welder_identifier: string;
  qualified_wps: string;
  qualified_ranges: string | null;
  expiry_date: string;
  status: WelderQualificationStatus;
  notes: string | null;
}

const STATUS_TONE: Record<WelderQualificationStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  expiring: "warning",
  expired: "danger",
};

// Cosmetic-only relabeling to match the enum-style status vocabulary a client's own sample
// dossier uses — the underlying stored value (WelderQualificationStatus) is unchanged.
const STATUS_LABEL: Record<WelderQualificationStatus, string> = {
  valid: "QUALIFIED",
  expiring: "EXPIRING_SOON",
  expired: "EXPIRED",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/PunchListTable.
export function WelderQualificationTable({ rows }: { rows: WelderQualificationDisplayRow[] }) {
  const columns: DataTableColumn<WelderQualificationDisplayRow>[] = [
    { key: "welder_identifier", header: "Welder", render: (row) => row.welder_identifier },
    { key: "qualified_wps", header: "Qualified WPS", render: (row) => row.qualified_wps },
    { key: "qualified_ranges", header: "Ranges", render: (row) => row.qualified_ranges ?? "—" },
    { key: "expiry_date", header: "Expiry", render: (row) => new Date(row.expiry_date).toLocaleDateString("en-GB") },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>,
    },
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search welders…"
      searchKeys={(row) => `${row.welder_identifier} ${row.qualified_wps}`}
      emptyMessage="No welder qualification records yet."
    />
  );
}
