"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { CalibrationStatus } from "@/lib/registers/types";

export interface CalibrationRegisterDisplayRow {
  id: string;
  instrument_name: string;
  cert_number: string;
  cal_date: string | null;
  due_date: string;
  status: CalibrationStatus;
  notes: string | null;
}

const STATUS_TONE: Record<CalibrationStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  due_soon: "warning",
  expired: "danger",
};

// Cosmetic-only relabeling to match the enum-style status vocabulary a client's own sample
// dossier uses (IN_CALIBRATION / DUE_WITHIN_60_DAYS / ...) — the underlying stored value
// (CalibrationStatus, computed by lib/registers/refresh.ts) is unchanged; this is display text only.
const STATUS_LABEL: Record<CalibrationStatus, string> = {
  valid: "IN_CALIBRATION",
  due_soon: "DUE_WITHIN_60_DAYS",
  expired: "CALIBRATION_EXPIRED",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/PunchListTable.
export function CalibrationTable({ rows }: { rows: CalibrationRegisterDisplayRow[] }) {
  const columns: DataTableColumn<CalibrationRegisterDisplayRow>[] = [
    { key: "instrument_name", header: "Instrument", render: (row) => row.instrument_name },
    { key: "cert_number", header: "Cert No.", render: (row) => <span className="doc-id">{row.cert_number}</span> },
    { key: "cal_date", header: "Cal. date", render: (row) => (row.cal_date ? new Date(row.cal_date).toLocaleDateString("en-GB") : "—") },
    { key: "due_date", header: "Due", render: (row) => new Date(row.due_date).toLocaleDateString("en-GB") },
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
      searchPlaceholder="Search instruments…"
      searchKeys={(row) => `${row.instrument_name} ${row.cert_number}`}
      emptyMessage="No calibration records yet."
    />
  );
}
