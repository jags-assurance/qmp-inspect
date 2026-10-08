"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useUrlPanel } from "@/components/ui/side-panel";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { SupportedLocale } from "@/lib/i18n/direction";
import { useServerDrivenTableParams } from "@/lib/hooks/use-server-driven-table-params";
import type { NcrSeverity, NcrStatus } from "@/lib/ncrs/types";
import { isOverdue } from "./is-overdue";
import { daysUntilDue } from "@/lib/ncrs/list-filters";
import { NCR_TABLE_PAGE_SIZE as PAGE_SIZE } from "./constants";

export interface NcrRegisterRow {
  id: string;
  ncr_number: string;
  severity: NcrSeverity;
  description: string;
  status: NcrStatus;
  due_date: string | null;
  created_at: string;
  /** Used with `timeZones` to judge overdue on the project's site day. */
  project_id?: string;
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

// Round-table finding: this column header was hardcoded "NCR No." even when reused on the
// Observation Register (observations/page.tsx renders the same NcrsTable), which is confusing on a
// register whose rows are actually all Observations. Parameterized by the caller instead.
function buildColumns(idColumnHeader: string, openPanel: (id: string) => void, timeZones?: Record<string, string>) {
  const tzOf = (row: NcrRegisterRow) => (row.project_id ? timeZones?.[row.project_id] : undefined);
  const columns: DataTableColumn<NcrRegisterRow>[] = [
  {
    key: "ncr_number",
    header: idColumnHeader,
    render: (row) => (
      <Link
        href={`/inspect/ncrs/${row.id}`}
        onClick={(e) => {
          // Plain left-click opens the side panel; modified clicks keep the real link behaviour.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          openPanel(row.id);
        }}
        className="doc-id inline-flex min-h-11 items-center text-burgundy hover:underline"
      >
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
        <Badge tone={STATUS_TONE[row.status]} showIcon>{STATUS_LABEL[row.status]}</Badge>
        {isOverdue(row, tzOf(row)) && <Badge tone="danger">Overdue</Badge>}
        {!isOverdue(row, tzOf(row)) && (daysUntilDue(row) ?? 99) <= 3 && <Badge tone="warning">Due soon</Badge>}
      </div>
    ),
  },
  ];
  return columns;
}

/**
 * Round-table performance finding: this register used to receive and client-filter EVERY matching
 * NCR/observation row at once — fine at a few hundred rows, a real problem once a large tenant
 * accumulates thousands. `totalCount` (when provided by the server page) switches this into
 * server-driven search + pagination: `rows` is just the current page, search text and page number
 * both live in the URL (`q`, `page`), so paging/searching is a real navigation the server page's own
 * query re-runs against — not an in-memory filter of a giant array. Falls back to the original
 * all-client-side behavior when `totalCount` is omitted, so call sites that pass a small, already-
 * complete row set (e.g. a single project's NCRs) need no changes.
 */
export function NcrsTable({
  rows,
  totalCount,
  idColumnHeader = "NCR No.",
  searchPlaceholder = "Search NCRs…",
  emptyMessage = "No NCRs or observations raised yet.",
  gradeAction = false,
  locale,
  timeZones,
}: {
  locale?: SupportedLocale;
  rows: NcrRegisterRow[];
  totalCount?: number;
  idColumnHeader?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Adds a "Grade to NCR" row link (observations register, staff). */
  gradeAction?: boolean;
  /** project_id -> IANA zone, so Overdue is judged on each project's site day. */
  timeZones?: Record<string, string>;
}) {
  const serverDriven = totalCount !== undefined;
  const { searchValue, setSearchValue, page, goToPage } = useServerDrivenTableParams(serverDriven);
  const panel = useUrlPanel("ncr");
  const openPanel = panel.open;
  const columns = useMemo(() => {
    const base = buildColumns(idColumnHeader, openPanel, timeZones);
    if (gradeAction) {
      base.push({
        key: "grade",
        header: "",
        render: (row) =>
          row.severity === "observation" && row.status !== "closed" ? (
            <Link href={`/inspect/ncrs/${row.id}#grade`} className="whitespace-nowrap text-xs font-medium text-burgundy hover:underline">
              Grade to NCR
            </Link>
          ) : null,
      });
    }
    return base;
  }, [idColumnHeader, openPanel, gradeAction, timeZones]);

  return (
    <DataTable
      columns={columns}
      locale={locale}
      rows={rows}
      caption="Non-conformance reports"
      mobileCards
      searchPlaceholder={searchPlaceholder}
      searchKeys={(row) => `${row.ncr_number} ${row.description} ${row.projects?.name ?? ""}`}
      emptyMessage={emptyMessage}
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
