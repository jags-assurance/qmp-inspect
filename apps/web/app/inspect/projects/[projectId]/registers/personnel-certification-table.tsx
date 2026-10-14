"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PERSONNEL_CERTIFICATION_EXPIRING_DAYS } from "@/lib/registers/status";
import { groupCertificatesByPerson } from "@/lib/registers/personnel";
import type { PersonnelCertificationStatus } from "@/lib/registers/types";
import { CertificateLink, ExpiryDate, formatRegisterDate, RegisterRowActions, RegisterDetails } from "./register-cells";
import { RegisterRowFlags } from "./register-lifecycle-actions";
import { Tx } from "@/components/domain/tx";

export interface PersonnelCertificationDisplayRow {
  id: string;
  certification_type: string;
  cert_number: string | null;
  issued_date: string | null;
  expiry_date: string;
  status: PersonnelCertificationStatus;
  certificate_path: string | null;
  verified_at?: string | null;
  lifecycle_status?: string | null;
  notes: string | null;
  project_parties: { name: string } | null;
  /** S3-09: the named person the certificate belongs to (absent before the column exists / when only the party is known). */
  holder_user_id?: string | null;
  holder_name?: string | null;
  project_party_id?: string | null;
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
export function PersonnelCertificationTable({ rows, projectId, canManage, editableIds = [] }: { rows: PersonnelCertificationDisplayRow[]; projectId: string; canManage: boolean; editableIds?: string[] }) {
  const columns: DataTableColumn<PersonnelCertificationDisplayRow>[] = [
    {
      key: "person",
      header: "Person",
      render: (row) =>
        row.holder_name ? (
          <span>
            {row.holder_name}
            <span className="block text-xs text-muted">{row.project_parties?.name ?? ""}</span>
          </span>
        ) : (
          (row.project_parties?.name ?? "—")
        ),
    },
    { key: "certification_type", header: "Certification", render: (row) => row.certification_type },
    { key: "expiry_date", header: "Expiry", render: (row) => <ExpiryDate date={row.expiry_date} warnWithinDays={PERSONNEL_CERTIFICATION_EXPIRING_DAYS} /> },
    { key: "status", header: "Status", render: (row) => (<span><Badge showIcon tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge><RegisterRowFlags verifiedAt={row.verified_at} lifecycleStatus={row.lifecycle_status} /></span>) },
    {
      key: "details",
      header: "More",
      render: (row) => (
        <RegisterDetails
          items={[
            { label: "Cert No.", value: row.cert_number ?? "—" },
            { label: "Issued", value: formatRegisterDate(row.issued_date) },
            { label: "Certificate", value: <CertificateLink kind="personnel" id={row.id} hasFile={!!row.certificate_path} /> },
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
          kind="personnel"
          visible={canManage || editableIds.includes(row.id)}
          contributorOnly={!canManage}
          projectId={projectId}
          verifiedAt={row.verified_at}
          hasCertificate={!!row.certificate_path}
          lifecycleStatus={row.lifecycle_status}
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

  const holderNames = new Map(rows.filter((r) => r.holder_user_id && r.holder_name).map((r) => [r.holder_user_id as string, r.holder_name as string]));
  const people = groupCertificatesByPerson(rows, holderNames);

  return (
    <>
      {people.length > 0 && (
        <div className="mb-3 rounded-md border border-border bg-off-white p-3" data-testid="personnel-by-person">
          <p className="text-xs font-medium uppercase tracking-wide text-muted"><Tx>By person</Tx></p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => (
              <li key={p.key} className="rounded border border-border bg-surface px-3 py-2 text-xs">
                <span className="block text-sm font-medium text-ink">{p.name}</span>
                {p.partyName && p.partyName !== p.name && <span className="block text-muted">{p.partyName}</span>}
                <span className="mt-1 block text-muted">
                  {p.total} <Tx>certificate</Tx>{p.total === 1 ? "" : "s"}
                  {p.expired > 0 && <span className="ms-1 font-medium text-danger">· {p.expired} <Tx>expired</Tx></span>}
                  {p.expiringSoon > 0 && <span className="ms-1 font-medium text-warning">· {p.expiringSoon} <Tx>expiring</Tx></span>}
                  {p.expired === 0 && p.expiringSoon === 0 && <span className="ms-1 text-success"><Tx>· all valid</Tx></span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    <DataTable
      mobileCards
      caption="Personnel certification register"
      columns={columns}
      rows={rows}
      scannable
      searchPlaceholder="Search people, certifications…"
      searchKeys={(row) => `${row.holder_name ?? ""} ${row.project_parties?.name ?? ""} ${row.certification_type} ${row.cert_number ?? ""}`}
      emptyMessage="No certifications yet — add the first one above, with the certificate."
    />
    </>
  );
}
