"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { WELDER_EXPIRING_DAYS } from "@/lib/registers/status";
import type { WelderQualificationStatus } from "@/lib/registers/types";
import { CertificateLink, ExpiryDate, RegisterRowActions, RegisterDetails } from "./register-cells";
import { RegisterRowFlags } from "./register-lifecycle-actions";

export interface WelderQualificationDisplayRow {
  id: string;
  welder_identifier: string;
  wpq_number: string | null;
  process: string | null;
  position: string | null;
  qualified_wps: string;
  qualified_ranges: string | null;
  expiry_date: string;
  status: WelderQualificationStatus;
  certificate_path: string | null;
  verified_at?: string | null;
  lifecycle_status?: string | null;
  notes: string | null;
}

const STATUS_TONE: Record<WelderQualificationStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  expiring: "warning",
  expired: "danger",
};

const STATUS_LABEL: Record<WelderQualificationStatus, string> = {
  valid: "Qualified",
  expiring: `Expiring within ${WELDER_EXPIRING_DAYS} days`,
  expired: "Expired",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/PunchListTable.
export function WelderQualificationTable({ rows, projectId, canManage, editableIds = [] }: { rows: WelderQualificationDisplayRow[]; projectId: string; canManage: boolean; editableIds?: string[] }) {
  const columns: DataTableColumn<WelderQualificationDisplayRow>[] = [
    {
      key: "welder_identifier",
      header: "Welder",
      render: (row) => (
        <span>
          {row.welder_identifier}
        </span>
      ),
    },
    { key: "expiry_date", header: "Expiry", render: (row) => <ExpiryDate date={row.expiry_date} warnWithinDays={WELDER_EXPIRING_DAYS} /> },
    { key: "status", header: "Status", render: (row) => (<span><Badge showIcon tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge><RegisterRowFlags verifiedAt={row.verified_at} lifecycleStatus={row.lifecycle_status} /></span>) },
    {
      key: "details",
      header: "More",
      render: (row) => (
        <RegisterDetails
          items={[
            { label: "WPQ", value: row.wpq_number ?? "—" },
            { label: "Qualified WPS", value: row.qualified_wps },
            { label: "Process", value: row.process ?? "—" },
            { label: "Position", value: row.position ?? "—" },
            { label: "Ranges", value: row.qualified_ranges ?? "—" },
            { label: "WPQ file", value: <CertificateLink kind="welder" id={row.id} hasFile={!!row.certificate_path} /> },
            { label: "Notes", value: row.notes ?? "—" },
          ]}
        />
      ),
    },
  ];
  if (canManage || editableIds.length > 0) {
    columns.push({
      key: "actions",
      header: "",
      render: (row) => (
        <RegisterRowActions
          kind="welder"
          visible={canManage || editableIds.includes(row.id)}
          contributorOnly={!canManage}
          projectId={projectId}
          verifiedAt={row.verified_at}
          hasCertificate={!!row.certificate_path}
          lifecycleStatus={row.lifecycle_status}
          row={{
            id: row.id,
            welder_identifier: row.welder_identifier,
            wpq_number: row.wpq_number,
            process: row.process,
            position: row.position,
            qualified_wps: row.qualified_wps,
            qualified_ranges: row.qualified_ranges,
            expiry_date: row.expiry_date,
            notes: row.notes,
          }}
        />
      ),
    });
  }

  return (
    <DataTable
      mobileCards
      caption="Welder qualification register"
      columns={columns}
      rows={rows}
      scannable
      searchPlaceholder="Search welders, WPS, WPQ…"
      searchKeys={(row) => `${row.welder_identifier} ${row.qualified_wps} ${row.wpq_number ?? ""} ${row.process ?? ""}`}
      emptyMessage="No welders yet — add the first qualification above, with the WPQ record."
    />
  );
}
