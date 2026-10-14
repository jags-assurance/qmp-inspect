"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  MATERIAL_APPROVAL_STATUS_LABELS,
  MATERIAL_RECEIPT_STATUS_LABELS,
  type MaterialApprovalStatus,
  type MaterialReceiptStatus,
} from "@/lib/registers/types";
import { CertificateLink, formatRegisterDate, RegisterRowActions, RegisterDetails } from "./register-cells";
import { RegisterRowFlags } from "./register-lifecycle-actions";

export interface MaterialRegisterDisplayRow {
  id: string;
  material_description: string;
  submittal_reference: string | null;
  approval_status: MaterialApprovalStatus;
  approved_date: string | null;
  heat_number: string | null;
  batch_number: string | null;
  po_reference: string | null;
  supplier: string | null;
  quantity: string | null;
  certificate_reference: string | null;
  certificate_path: string | null;
  verified_at?: string | null;
  lifecycle_status?: string | null;
  receipt_status: MaterialReceiptStatus;
  disposition_notes: string | null;
  released_at: string | null;
  notes: string | null;
}

const APPROVAL_TONE: Record<MaterialApprovalStatus, "success" | "warning" | "danger"> = {
  A: "success",
  B: "success",
  C: "warning",
  D: "danger",
};

const RECEIPT_TONE: Record<MaterialReceiptStatus, "success" | "warning" | "danger"> = {
  released: "success",
  received_pending_inspection: "warning",
  quarantined_pending_disposition: "warning",
  on_hold: "danger",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/PunchListTable.
export function MaterialTable({ rows, projectId, canManage, editableIds = [] }: { rows: MaterialRegisterDisplayRow[]; projectId: string; canManage: boolean; editableIds?: string[] }) {
  const columns: DataTableColumn<MaterialRegisterDisplayRow>[] = [
    {
      key: "material_description",
      header: "Material",
      render: (row) => (
        <span>
          {row.material_description}
        </span>
      ),
    },
    {
      key: "approval_status",
      header: "Approval",
      render: (row) => (
        <Badge showIcon tone={APPROVAL_TONE[row.approval_status]}>
          {row.approval_status} — {MATERIAL_APPROVAL_STATUS_LABELS[row.approval_status]}
        </Badge>
      ),
    },
    {
      key: "receipt_status",
      header: "Receiving inspection",
      render: (row) => (
        <div>
          <Badge showIcon tone={RECEIPT_TONE[row.receipt_status]}>{MATERIAL_RECEIPT_STATUS_LABELS[row.receipt_status]}</Badge>
          <RegisterRowFlags verifiedAt={row.verified_at} lifecycleStatus={row.lifecycle_status} />
        </div>
      ),
    },
    {
      key: "details",
      header: "More",
      render: (row) => (
        <RegisterDetails
          items={[
            { label: "Submittal ref.", value: row.submittal_reference ?? "—" },
            { label: "Approved", value: formatRegisterDate(row.approved_date) },
            { label: "Supplier", value: row.supplier ?? "—" },
            { label: "Quantity", value: row.quantity ?? "—" },
            { label: "Heat", value: row.heat_number ?? "—" },
            { label: "Batch", value: row.batch_number ?? "—" },
            { label: "PO", value: row.po_reference ?? "—" },
            { label: "Cert ref.", value: row.certificate_reference ?? "—" },
            { label: "Released", value: formatRegisterDate(row.released_at) },
            { label: "Disposition", value: row.disposition_notes ?? "—" },
            { label: "MTC / CoC", value: <CertificateLink kind="material" id={row.id} hasFile={!!row.certificate_path} /> },
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
          kind="material"
          visible={canManage || editableIds.includes(row.id)}
          contributorOnly={!canManage}
          projectId={projectId}
          verifiedAt={row.verified_at}
          hasCertificate={!!row.certificate_path}
          lifecycleStatus={row.lifecycle_status}
          row={{
            id: row.id,
            material_description: row.material_description,
            submittal_reference: row.submittal_reference,
            approval_status: row.approval_status,
            approved_date: row.approved_date,
            heat_number: row.heat_number,
            batch_number: row.batch_number,
            po_reference: row.po_reference,
            supplier: row.supplier,
            quantity: row.quantity,
            certificate_reference: row.certificate_reference,
            receipt_status: row.receipt_status,
            disposition_notes: row.disposition_notes,
            notes: row.notes,
          }}
        />
      ),
    });
  }

  return (
    <DataTable
      mobileCards
      caption="Material register"
      columns={columns}
      rows={rows}
      scannable
      searchPlaceholder="Search materials, heat, batch, PO, supplier…"
      searchKeys={(row) =>
        `${row.material_description} ${row.submittal_reference ?? ""} ${row.heat_number ?? ""} ${row.batch_number ?? ""} ${row.po_reference ?? ""} ${row.supplier ?? ""}`
      }
      emptyMessage="No materials yet — add the first delivery above, with its mill/test certificate."
    />
  );
}
