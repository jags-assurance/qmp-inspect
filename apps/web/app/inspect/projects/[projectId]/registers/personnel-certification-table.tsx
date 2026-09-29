"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { PersonnelCertificationStatus } from "@/lib/registers/types";

export interface PersonnelCertificationDisplayRow {
  id: string;
  certification_type: string;
  cert_number: string | null;
  issued_date: string | null;
  expiry_date: string;
  status: PersonnelCertificationStatus;
  notes: string | null;
  project_parties: { name: string } | null;
}

const STATUS_TONE: Record<PersonnelCertificationStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  expiring_soon: "warning",
  expired: "danger",
};

const STATUS_LABEL: Record<PersonnelCertificationStatus, string> = {
  valid: "Valid",
  expiring_soon: "Expiring soon",
  expired: "Expired",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// same wrapper pattern as CalibrationTable/WelderQualificationTable.
export function PersonnelCertificationTable({ rows }: { rows: PersonnelCertificationDisplayRow[] }) {
  const columns: DataTableColumn<PersonnelCertificationDisplayRow>[] = [
    { key: "person", header: "Person", render: (row) => row.project_parties?.name ?? "—" },
    { key: "certification_type", header: "Certification", render: (row) => row.certification_type },
    { key: "cert_number", header: "Cert No.", render: (row) => row.cert_number ?? "—" },
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
      searchPlaceholder="Search certifications…"
      searchKeys={(row) => `${row.project_parties?.name ?? ""} ${row.certification_type}`}
      emptyMessage="No personnel certification records yet."
    />
  );
}
