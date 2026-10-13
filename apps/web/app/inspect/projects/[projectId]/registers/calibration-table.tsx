"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { CALIBRATION_DUE_SOON_DAYS } from "@/lib/registers/status";
import type { CalibrationStatus } from "@/lib/registers/types";
import { CertificateLink, formatRegisterDate, ExpiryDate, RegisterRowActions, RegisterDetails } from "./register-cells";
import { RegisterRowFlags } from "./register-lifecycle-actions";
import { Tx } from "@/components/domain/tx";

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
  verified_at?: string | null;
  lifecycle_status?: string | null;
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
          {row.instrument_tag && <span className="block text-xs text-muted"><Tx>ID</Tx> {row.instrument_tag}</span>}
        </span>
      ),
    },
    { key: "due_date", header: "Due", render: (row) => <ExpiryDate date={row.due_date} warnWithinDays={CALIBRATION_DUE_SOON_DAYS} /> },
    { key: "status", header: "Status", render: (row) => (<span><Badge showIcon tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge><RegisterRowFlags verifiedAt={row.verified_at} lifecycleStatus={row.lifecycle_status} /></span>) },
    {
      key: "details",
      header: "More",
      render: (row) => (
        <RegisterDetails
          items={[
            { label: "Cert No.", value: <span className="doc-id">{row.cert_number}</span> },
            { label: "Lab", value: row.calibration_lab ?? "—" },
            { label: "Cal. date", value: formatRegisterDate(row.cal_date) },
            { label: "Certificate", value: <CertificateLink kind="calibration" id={row.id} hasFile={!!row.certificate_path} /> },
            { label: "Notes", value: row.notes ?? "—" },
          ]}
        />
      ),
    },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      render: (row) => (
        <RegisterRowActions
          kind="calibration"
          projectId={projectId}
          verifiedAt={row.verified_at}
          hasCertificate={!!row.certificate_path}
          lifecycleStatus={row.lifecycle_status}
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
      scannable
      searchPlaceholder="Search instruments, tags, certificates…"
      searchKeys={(row) => `${row.instrument_name} ${row.instrument_tag ?? ""} ${row.cert_number} ${row.calibration_lab ?? ""}`}
      emptyMessage="No instruments yet — add the first one above, with its calibration certificate."
    />
  );
}
