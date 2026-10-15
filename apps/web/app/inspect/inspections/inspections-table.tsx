"use client";
import { formatLocationForDisplay } from "@/lib/checklists/location";

import Link from "next/link";
import { INSPECTIONS_PAGE_SIZE } from "./page-size";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { bulkIssueIrnAction } from "@/lib/checklists/actions";
import { BULK_IRN_MAX, isBulkIrnEligible, summariseBulk, type BulkIrnResult } from "@/lib/checklists/bulk-irn";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { SupportedLocale } from "@/lib/i18n/direction";
import { useServerDrivenTableParams } from "@/lib/hooks/use-server-driven-table-params";
import { Tx } from "@/components/domain/tx";


export interface InspectionListRow {
  id: string;
  record_number: string;
  project_name: string;
  itp_number: string;
  activity: string;
  location: string | null;
  inspection_date: string;
  overall_result: "pass" | "fail" | "partial" | null;
  inspector_name: string | null;
  irn_number: string | null;
  irn_voided: boolean;
  open_ncrs: number;
}

function ResultChip({ result }: { result: InspectionListRow["overall_result"] }) {
  if (result === "pass") return <Badge tone="success"><Tx>Pass</Tx></Badge>;
  if (result === "fail") return <Badge tone="danger"><Tx>Fail</Tx></Badge>;
  if (result === "partial") return <Badge tone="warning"><Tx>Conditional</Tx></Badge>;
  return <Badge tone="neutral"><Tx>In progress</Tx></Badge>;
}

const columns: DataTableColumn<InspectionListRow>[] = [
  {
    key: "record_number",
    header: "Record No.",
    render: (r) => (
      <Link href={`/inspect/inspections/${r.id}`} className="doc-id inline-flex min-h-11 items-center text-burgundy hover:underline">
        {r.record_number}
      </Link>
    ),
  },
  { key: "project", header: "Project", render: (r) => r.project_name },
  {
    key: "itp",
    header: "ITP / Activity",
    render: (r) => (
      <div>
        <span className="doc-id">{r.itp_number}</span>
        <div className="line-clamp-1 max-w-xs text-muted" title={r.activity}>{r.activity}</div>
      </div>
    ),
  },
  { key: "location", header: "Location", render: (r) => formatLocationForDisplay(r.location) },
  { key: "date", header: "Date", render: (r) => r.inspection_date },
  { key: "inspector", header: "Inspector", render: (r) => r.inspector_name ?? "—" },
  { key: "result", header: "Result", render: (r) => <ResultChip result={r.overall_result} /> },
  {
    key: "irn",
    header: "IRN",
    render: (r) =>
      !r.irn_number ? (
        <span className="text-muted"><Tx>None</Tx></span>
      ) : r.irn_voided ? (
        <span className="inline-flex items-center gap-2">
          <span className="doc-id line-through">{r.irn_number}</span>
          <Badge tone="danger"><Tx>VOID</Tx></Badge>
        </span>
      ) : (
        <Badge tone="info">{r.irn_number}</Badge>
      ),
  },
  {
    key: "ncrs",
    header: "Open NCRs",
    render: (r) => (r.open_ncrs > 0 ? <Badge tone="danger">{r.open_ncrs}</Badge> : <span className="text-muted">0</span>),
  },
];

export function InspectionsTable({ rows, totalCount, locale }: { rows: InspectionListRow[]; totalCount: number; locale?: SupportedLocale }) {
  const { searchValue, setSearchValue, page, goToPage } = useServerDrivenTableParams(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BulkIrnResult | null>(null);
  const [pending, startTransition] = useTransition();
  const { ask, dialog } = useConfirm();

  const eligibleIds = useMemo(() => rows.filter(isBulkIrnEligible).map((r) => r.id), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  // Selection only ever holds ids still on this page and still eligible (a paged/refreshed list drops stale ones).
  const chosen = eligibleIds.filter((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectColumn: DataTableColumn<InspectionListRow> = {
    key: "select",
    header: "Select",
    render: (r) =>
      isBulkIrnEligible(r) ? (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggle(r.id)}
          disabled={pending}
          aria-label={`Select ${r.record_number} for bulk IRN issue`}
          className="h-5 w-5"
        />
      ) : null,
  };

  async function run() {
    const ok = await ask({
      title: `Issue ${chosen.length} IRN${chosen.length === 1 ? "" : "s"}?`,
      message: "Each selected inspection goes through the same checks as issuing it individually (assigned party, open Holds, mandatory N/A items, open NCRs). Any that fail are skipped and reported; the rest are issued.",
      confirmLabel: "Issue IRNs",
    });
    if (ok === null) return;
    const ids = chosen;
    startTransition(async () => {
      const res = await bulkIssueIrnAction(ids);
      setResult(res);
      setSelected(new Set());
    });
  }

  const summary = result ? summariseBulk(result.items) : null;

  return (
    <div>
      {dialog}
      {eligibleIds.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <Button type="button" size="sm" disabled={pending || chosen.length === 0 || chosen.length > BULK_IRN_MAX} onClick={run}>
            {pending ? "Issuing…" : `Issue IRN for selected (${chosen.length})`}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => setSelected(new Set(chosen.length === eligibleIds.length ? [] : eligibleIds.slice(0, BULK_IRN_MAX)))}
          >
            {chosen.length === eligibleIds.length ? "Clear selection" : "Select all eligible on this page"}
          </Button>
          <span className="text-muted"><Tx>Completed inspections without a live IRN. Up to</Tx> {BULK_IRN_MAX} <Tx>at a time.</Tx></span>
        </div>
      )}
      {result && (
        <div className="mb-3 rounded-lg border border-border bg-surface p-3 text-sm" role="status">
          {result.error ? (
            <p className="text-danger">{result.error}</p>
          ) : (
            <>
              <p className="font-medium text-ink">
                {summary!.issued} <Tx>issued,</Tx> {summary!.already} <Tx>already issued,</Tx> {summary!.skipped} <Tx>skipped.</Tx>
              </p>
              <ul className="mt-2 space-y-1">
                {result.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                    <Link href={`/inspect/inspections/${i.id}`} className="doc-id text-burgundy hover:underline">
                      {byId.get(i.id)?.record_number ?? i.id}
                    </Link>
                    {i.status === "issued" && <Badge tone="success">{i.irnNumber}</Badge>}
                    {i.status === "already" && <Badge tone="info"><Tx>Already issued</Tx></Badge>}
                    {i.status === "skipped" && <span className="text-danger"><Tx>Skipped:</Tx> {i.reason}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button type="button" variant="link" className="mt-2" onClick={() => setResult(null)}>
            <Tx>Dismiss</Tx>
          </Button>
        </div>
      )}
      <DataTable
        columns={eligibleIds.length > 0 ? [selectColumn, ...columns] : columns}
        locale={locale}
        rows={rows}
        searchPlaceholder="Search record no., activity or ITP…"
        searchKeys={(r) => `${r.record_number} ${r.activity} ${r.itp_number}`}
        emptyMessage="No inspections match these filters."
        serverSearch={{ value: searchValue, onChange: setSearchValue }}
        pagination={{ page, pageSize: INSPECTIONS_PAGE_SIZE, totalCount, onPageChange: goToPage }}
      />
    </div>
  );
}
