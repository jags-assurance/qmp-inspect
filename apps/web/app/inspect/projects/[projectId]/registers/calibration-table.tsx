"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { CALIBRATION_DUE_SOON_DAYS } from "@/lib/registers/status";
import type { CalibrationStatus } from "@/lib/registers/types";
import { CertificateLink, formatRegisterDate, ExpiryDate, RegisterRowActions } from "./register-cells";

export interface CalibrationRegisterDisplayRow {
  id: string;
  instrument_name: string;
  instrument_tag: string | null;
  calibration_lab: string | null;
  cert_number: string;
  cal_date: string | null;
  due_date: string;
  status: CalibrationStatus;
  certificate_path: string | null;
  notes: string | null;
}

const STATUS_TONE: Record<CalibrationStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  due_soon: "warning",
  expired: "danger",
};

const STATUS_LABEL: Record<CalibrationStatus, string> = {
  valid: "In calibration",
  due_soon: `Due within ${CALIBRATION_DUE_SOON_DAYS} days`,
  expired: "Calibration expired",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/PunchListTable.
export function CalibrationTable({ rows, projectId, canManage }: { rows: CalibrationRegisterDisplayRow[]; projectId: string; canManage: boolean }) {
  const columns: DataTableColumn<CalibrationRegisterDisplayRow>[] = [
    {
      key: "instrument_name",
      header: "Instrument",
      render: (row) => (
        <span>
          {row.instrument_name}
          {row.instrument_tag && <span className="block text-xs text-muted">ID {row.instrument_tag}</span>}
        </span>
      ),
    },
    {
      key: "cert_number",
      header: "Cert No.",
      render: (row) => (
        <span>
          <span className="doc-id">{row.cert_number}</span>
          {row.calibration_lab && <span className="block text-xs text-muted">{row.calibration_lab}</span>}
        </span>
      ),
    },
    { key: "cal_date", header: "Cal. date", render: (row) => formatRegisterDate(row.cal_date) },
    { key: "due_date", header: "Due", render: (row) => <ExpiryDate date={row.due_date} warnWithinDays={CALIBRATION_DUE_SOON_DAYS} /> },
    { key: "status", header: "Status", render: (row) => <Badge showIcon tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge> },
    { key: "certificate", header: "Certificate", render: (row) => <CertificateLink kind="calibration" id={row.id} hasFile={!!row.certificate_path} /> },
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      render: (row) => (
        <RegisterRowActions
          kind="calibration"
          projectId={projectId}
          row={{
            id: row.id,
            instrument_name: row.instrument_name,
            instrument_tag: row.instrument_tag,
            calibration_lab: row.calibration_lab,
            cert_number: row.cert_number,
            cal_date: row.cal_date,
            due_date: row.due_date,
            notes: row.notes,
          }}
        />
      ),
    });
  }

  return (
    <DataTable
      mobileCards
      caption="Calibration register"
      columns={columns}
      rows={rows}
      searchPlaceholder="Search instruments, tags, certificates…"
      searchKeys={(row) => `${row.instrument_name} ${row.instrument_tag ?? ""} ${row.cert_number} ${row.calibration_lab ?? ""}`}
      emptyMessage="No instruments yet — add the first one above, with its calibration certificate."
    />
  );
}
