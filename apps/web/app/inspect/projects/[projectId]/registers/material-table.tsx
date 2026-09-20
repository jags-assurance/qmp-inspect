"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  MATERIAL_APPROVAL_STATUS_LABELS,
  MATERIAL_RECEIPT_STATUS_LABELS,
  type MaterialApprovalStatus,
  type MaterialReceiptStatus,
} from "@/lib/registers/types";

export interface MaterialRegisterDisplayRow {
  id: string;
  material_description: string;
  submittal_reference: string | null;
  approval_status: MaterialApprovalStatus;
  approved_date: string | null;
  heat_number: string | null;
  batch_number: string | null;
  po_reference: string | null;
  certificate_reference: string | null;
  receipt_status: MaterialReceiptStatus;
  disposition_notes: string | null;
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
  quarantined_pending_disposition: "warning",
  on_hold: "danger",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/PunchListTable.
export function MaterialTable({ rows }: { rows: MaterialRegisterDisplayRow[] }) {
  const columns: DataTableColumn<MaterialRegisterDisplayRow>[] = [
    { key: "material_description", header: "Material", render: (row) => row.material_description },
    { key: "submittal_reference", header: "Submittal ref.", render: (row) => row.submittal_reference ?? "—" },
    {
      key: "approval_status",
      header: "Approval",
      render: (row) => (
        <Badge tone={APPROVAL_TONE[row.approval_status]}>
          {row.approval_status} — {MATERIAL_APPROVAL_STATUS_LABELS[row.approval_status]}
        </Badge>
      ),
    },
    {
      key: "approved_date",
      header: "Approved",
      render: (row) => (row.approved_date ? new Date(row.approved_date).toLocaleDateString() : "—"),
    },
    {
      key: "traceability",
      header: "Traceability",
      render: (row) => {
        const parts = [
          row.heat_number && `Heat ${row.heat_number}`,
          row.batch_number && `Batch ${row.batch_number}`,
          row.po_reference && `PO ${row.po_reference}`,
          row.certificate_reference && `Cert ${row.certificate_reference}`,
        ].filter(Boolean);
        return parts.length > 0 ? <span className="text-xs">{parts.join(" · ")}</span> : "—";
      },
    },
    {
      key: "receipt_status",
      header: "Receiving inspection",
      render: (row) => (
        <div>
          <Badge tone={RECEIPT_TONE[row.receipt_status]}>{MATERIAL_RECEIPT_STATUS_LABELS[row.receipt_status]}</Badge>
          {row.disposition_notes && <p className="mt-1 text-xs text-muted">{row.disposition_notes}</p>}
        </div>
      ),
    },
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search materials…"
      searchKeys={(row) =>
        `${row.material_description} ${row.submittal_reference ?? ""} ${row.heat_number ?? ""} ${row.batch_number ?? ""} ${row.po_reference ?? ""}`
      }
      emptyMessage="No material approval records yet."
    />
  );
}
