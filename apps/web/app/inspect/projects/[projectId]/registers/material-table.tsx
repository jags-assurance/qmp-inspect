"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { MATERIAL_APPROVAL_STATUS_LABELS, type MaterialApprovalStatus } from "@/lib/registers/types";

export interface MaterialRegisterDisplayRow {
  id: string;
  material_description: string;
  submittal_reference: string | null;
  approval_status: MaterialApprovalStatus;
  approved_date: string | null;
  notes: string | null;
}

const APPROVAL_TONE: Record<MaterialApprovalStatus, "success" | "warning" | "danger"> = {
  A: "success",
  B: "success",
  C: "warning",
  D: "danger",
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
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search materials…"
      searchKeys={(row) => `${row.material_description} ${row.submittal_reference ?? ""}`}
      emptyMessage="No material approval records yet."
    />
  );
}
