"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { NcrSeverity, NcrStatus } from "@/lib/ncrs/types";
import { isOverdue } from "./is-overdue";

export interface NcrRegisterRow {
  id: string;
  ncr_number: string;
  severity: NcrSeverity;
  description: string;
  status: NcrStatus;
  due_date: string | null;
  created_at: string;
  projects: { name: string; project_number: string } | null;
  itp_items: { master_disciplines: { code: string; name: string } | null } | null;
}

const SEVERITY_TONE: Record<NcrSeverity, "danger" | "warning" | "info"> = {
  major_ncr: "danger",
  minor_ncr: "warning",
  observation: "info",
};

const SEVERITY_LABEL: Record<NcrSeverity, string> = {
  major_ncr: "Major NCR",
  minor_ncr: "Minor NCR",
  observation: "Observation",
};

const STATUS_TONE: Record<NcrStatus, "neutral" | "warning" | "gold" | "success"> = {
  open: "neutral",
  in_progress: "warning",
  pending_verification: "gold",
  closed: "success",
};

const STATUS_LABEL: Record<NcrStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_verification: "Pending verification",
  closed: "Closed",
};

const COLUMNS: DataTableColumn<NcrRegisterRow>[] = [
  {
    key: "ncr_number",
    header: "NCR No.",
    render: (row) => (
      <Link href={`/inspect/ncrs/${row.id}`} className="doc-id text-burgundy hover:underline">
        {row.ncr_number}
      </Link>
    ),
  },
  {
    key: "severity",
    header: "Severity",
    render: (row) => <Badge tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABEL[row.severity]}</Badge>,
  },
  { key: "description", header: "Description", render: (row) => row.description },
  {
    key: "discipline",
    header: "Discipline",
    render: (row) =>
      row.itp_items?.master_disciplines ? (
        <Badge tone="neutral">{row.itp_items.master_disciplines.code}</Badge>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: "project", header: "Project", render: (row) => row.projects?.name ?? "—" },
  { key: "due_date", header: "Due", render: (row) => row.due_date ?? "—" },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <div className="flex items-center gap-2">
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
        {isOverdue(row) && <Badge tone="danger">Overdue</Badge>}
      </div>
    ),
  },
];

export function NcrsTable({ rows }: { rows: NcrRegisterRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search NCRs…"
      searchKeys={(row) => `${row.ncr_number} ${row.description} ${row.projects?.name ?? ""}`}
      emptyMessage="No NCRs or observations raised yet."
    />
  );
}
