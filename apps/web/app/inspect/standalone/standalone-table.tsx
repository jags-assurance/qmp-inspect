"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useServerDrivenTableParams } from "@/lib/hooks/use-server-driven-table-params";
import type { AssignmentConclusion, AssignmentStatus, AssignmentType } from "@/lib/standalone/actions";
import { STANDALONE_TABLE_PAGE_SIZE as PAGE_SIZE } from "./constants";
import { Tx } from "@/components/domain/tx";

export interface StandaloneAssignmentListRow {
  id: string;
  assignment_number: string;
  assignment_type: AssignmentType;
  equipment_description: string;
  assignment_date: string | null;
  status: AssignmentStatus;
  conclusion: AssignmentConclusion | null;
  discipline_id: string | null;
  projects: { name: string } | null;
  master_disciplines: { code: string; name: string } | null;
}

const TYPE_LABEL: Record<AssignmentType, string> = {
  fat: "FAT",
  witness_inspection: "Witness Inspection",
  specific_test: "Specific Test",
  pre_shipment: "Pre-Shipment",
};

const CONCLUSION_LABEL: Record<AssignmentConclusion, string> = {
  pass: "Pass",
  conditional_pass: "Conditional Pass",
  fail: "Fail",
};

const CONCLUSION_TONE: Record<AssignmentConclusion, "success" | "warning" | "danger"> = {
  pass: "success",
  conditional_pass: "warning",
  fail: "danger",
};

function StatusBadge({ row }: { row: StandaloneAssignmentListRow }) {
  return row.status === "draft" ? (
    <Badge tone="neutral" showIcon><Tx>Draft</Tx></Badge>
  ) : (
    <Badge tone={row.conclusion ? CONCLUSION_TONE[row.conclusion] : "neutral"} showIcon>
      {row.conclusion ? CONCLUSION_LABEL[row.conclusion] : "Completed"}
      {row.status === "conditional_open" ? " — awaiting clearance" : ""}
    </Badge>
  );
}

const COLUMNS: DataTableColumn<StandaloneAssignmentListRow>[] = [
  {
    key: "assignment_number",
    header: "Assignment No.",
    render: (row) => (
      <Link href={`/inspect/standalone/${row.id}`} className="doc-id inline-flex min-h-11 items-center text-burgundy hover:underline">
        {row.assignment_number}
      </Link>
    ),
  },
  {
    key: "assignment_type",
    header: "Type",
    render: (row) => <Badge tone="neutral">{TYPE_LABEL[row.assignment_type]}</Badge>,
  },
  {
    key: "equipment_description",
    header: "Equipment",
    render: (row) => (
      <span className="line-clamp-1 max-w-xs [overflow-wrap:anywhere]" title={row.equipment_description}>
        {row.equipment_description}
      </span>
    ),
  },
  { key: "project", header: "Project", render: (row) => row.projects?.name ?? "—" },
  {
    key: "discipline",
    header: "Discipline",
    render: (row) =>
      row.master_disciplines ? (
        <Badge tone="neutral">{row.master_disciplines.code}</Badge>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: "assignment_date", header: "Date", render: (row) => row.assignment_date ?? "—" },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge row={row} />,
  },
];

/**
 * Round-table performance finding (same as apps/web/app/inspect/ncrs/ncrs-table.tsx): this
 * register used to receive and client-filter EVERY matching assignment row at once. `totalCount`
 * (when provided by the server page) switches this into server-driven search + pagination: `rows`
 * is just the current page, search text and page number both live in the URL (`q`, `page`). Falls
 * back to the original all-client-side behavior when `totalCount` is omitted.
 */
export function StandaloneTable({ rows, totalCount }: { rows: StandaloneAssignmentListRow[]; totalCount?: number }) {
  const serverDriven = totalCount !== undefined;
  const { searchValue, setSearchValue, page, goToPage } = useServerDrivenTableParams(serverDriven);

  return (
    <DataTable
      mobileCards
      breakpoint="md"
      renderCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/inspect/standalone/${row.id}`} className="doc-id inline-flex min-h-11 items-center text-base font-semibold text-burgundy hover:underline">
              {row.assignment_number}
            </Link>
            <Badge tone="neutral">{TYPE_LABEL[row.assignment_type]}</Badge>
          </div>
          <p className="line-clamp-2 text-sm text-ink [overflow-wrap:anywhere]">{row.equipment_description}</p>
          <StatusBadge row={row} />
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="min-w-0 truncate" title={row.projects?.name ?? ""}>{row.projects?.name ?? "—"}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{row.assignment_date ?? "—"}</span>
            {row.master_disciplines && <Badge tone="neutral" showIcon={false}>{row.master_disciplines.code}</Badge>}
          </p>
        </div>
      )}
      caption="Standalone assignments"
      columns={COLUMNS}
      rows={rows}
      searchPlaceholder="Search assignments…"
      searchKeys={(row) => `${row.assignment_number} ${row.equipment_description}`}
      emptyMessage="No standalone assignments match. Adjust the filters or create one with + New assignment."
      serverSearch={serverDriven ? { value: searchValue, onChange: setSearchValue } : undefined}
      pagination={
        serverDriven
          ? {
              page,
              pageSize: PAGE_SIZE,
              totalCount: totalCount!,
              onPageChange: goToPage,
            }
          : undefined
      }
    />
  );
}
