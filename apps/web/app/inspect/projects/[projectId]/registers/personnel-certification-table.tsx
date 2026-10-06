"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PERSONNEL_CERTIFICATION_EXPIRING_DAYS } from "@/lib/registers/status";
import type { PersonnelCertificationStatus } from "@/lib/registers/types";
import { CertificateLink, ExpiryDate, RegisterRowActions } from "./register-cells";

export interface PersonnelCertificationDisplayRow {
  id: string;
  certification_type: string;
  cert_number: string | null;
  issued_date: string | null;
  expiry_date: string;
  status: PersonnelCertificationStatus;
  certificate_path: string | null;
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
  expiring_soon: `Expiring within ${PERSONNEL_CERTIFICATION_EXPIRING_DAYS} days`,
  expired: "Expired",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// same wrapper pattern as CalibrationTable/WelderQualificationTable.
export function PersonnelCertificationTable({ rows, projectId, canManage }: { rows: PersonnelCertificationDisplayRow[]; projectId: string; canManage: boolean }) {
  const columns: DataTableColumn<PersonnelCertificationDisplayRow>[] = [
    { key: "person", header: "Person", render: (row) => row.project_parties?.name ?? "—" },
    { key: "certification_type", header: "Certification", render: (row) => row.certification_type },
    { key: "cert_number", header: "Cert No.", render: (row) => row.cert_number ?? "—" },
    { key: "expiry_date", header: "Expiry", render: (row) => <ExpiryDate date={row.expiry_date} warnWithinDays={PERSONNEL_CERTIFICATION_EXPIRING_DAYS} /> },
    { key: "status", header: "Status", render: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge> },
    { key: "certificate", header: "Certificate", render: (row) => <CertificateLink kind="personnel" id={row.id} hasFile={!!row.certificate_path} /> },
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
  ];
  if (canManage) {
    columns.push({
      key: "actions",
      header: "",
      render: (row) => (
        <RegisterRowActions
          kind="personnel"
          projectId={projectId}
          row={{
            id: row.id,
            certification_type: row.certification_type,
            cert_number: row.cert_number,
            issued_date: row.issued_date,
            expiry_date: row.expiry_date,
            notes: row.notes,
          }}
        />
      ),
    });
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search people, certifications…"
      searchKeys={(row) => `${row.project_parties?.name ?? ""} ${row.certification_type} ${row.cert_number ?? ""}`}
      emptyMessage="No certifications yet — add the first one above, with the certificate."
    />
  );
}
