"use client";
import { formatLocationForDisplay } from "@/lib/checklists/location";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useServerDrivenTableParams } from "@/lib/hooks/use-server-driven-table-params";

export const INSPECTIONS_PAGE_SIZE = 50;

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
  if (result === "pass") return <Badge tone="success">Pass</Badge>;
  if (result === "fail") return <Badge tone="danger">Fail</Badge>;
  if (result === "partial") return <Badge tone="warning">Conditional</Badge>;
  return <Badge tone="neutral">In progress</Badge>;
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
        <div className="text-muted">{r.activity}</div>
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
        <span className="text-muted">None</span>
      ) : r.irn_voided ? (
        <span className="inline-flex items-center gap-2">
          <span className="doc-id line-through">{r.irn_number}</span>
          <Badge tone="danger">VOID</Badge>
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

export function InspectionsTable({ rows, totalCount }: { rows: InspectionListRow[]; totalCount: number }) {
  const { searchValue, setSearchValue, page, goToPage } = useServerDrivenTableParams(true);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search record no., activity or ITP…"
      searchKeys={(r) => `${r.record_number} ${r.activity} ${r.itp_number}`}
      emptyMessage="No inspections match these filters."
      serverSearch={{ value: searchValue, onChange: setSearchValue }}
      pagination={{ page, pageSize: INSPECTIONS_PAGE_SIZE, totalCount, onPageChange: goToPage }}
    />
  );
}
