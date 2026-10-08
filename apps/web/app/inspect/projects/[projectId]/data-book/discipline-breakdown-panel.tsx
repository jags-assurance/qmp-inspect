import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import type { DataBookDisciplineRow } from "@/lib/databook/discipline-breakdown";

const columns: ResponsiveColumn<DataBookDisciplineRow>[] = [
  {
    key: "discipline",
    header: "Discipline",
    render: (row) => (
      <>
        <span className="font-medium text-ink">{row.disciplineName}</span>
        <span className="ms-2 text-xs text-muted">{row.disciplineCode}</span>
      </>
    ),
  },
  { key: "itps", header: "ITPs", tdClassName: "text-ink", render: (row) => row.itpCount },
  {
    key: "ncrs",
    header: "NCRs",
    render: (row) => <Badge tone={row.ncrCount === 0 ? "success" : "warning"}>{row.ncrCount}</Badge>,
  },
  {
    key: "ftpr",
    header: "First-time pass rate",
    tdClassName: "text-ink",
    render: (row) =>
      row.firstTimePassRate === null ? (
        <span className="text-muted">No inspections yet</span>
      ) : (
        <>
          <Badge tone={row.firstTimePassRate === 100 ? "success" : row.firstTimePassRate >= 80 ? "warning" : "danger"}>
            {row.firstTimePassRate}%
          </Badge>
          <span className="ms-2 text-xs text-muted">
            {row.firstTimePasses}/{row.firstAttempts}
          </span>
        </>
      ),
  },
];

/**
 * R88 — service/discipline breakdown alongside the project-wide ReadinessPanel above it: the same
 * ITP/NCR/first-time-pass-rate figures, grouped by discipline (master_disciplines) instead of
 * collapsed into one project total. Rows with no discipline-tagged activity are omitted rather
 * than shown as an empty "Unassigned" row — see discipline-breakdown.ts's honesty rule.
 */
export function DisciplineBreakdownPanel({ rows }: { rows: DataBookDisciplineRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-medium text-ink">Breakdown by service / discipline</h2>
        <p className="mt-2 text-sm text-muted">
          No ITP activities on this project are tagged with a discipline yet, so no per-discipline
          breakdown is available.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-ink">Breakdown by service / discipline</h2>
      <p className="mt-1 text-xs text-muted">
        Same ITP, NCR and first-time-pass-rate figures as the project-wide totals above, grouped by
        discipline. An ITP spanning multiple disciplines is counted once in each.
      </p>

      <div className="mt-3">
        <ResponsiveTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.disciplineCode}
          caption="Breakdown by discipline"
          tableClassName="w-full text-start text-sm"
          headRowClassName="border-b border-border text-xs uppercase tracking-wide text-muted"
          thClassName="py-2 pe-3 font-medium"
          tdClassName="py-2 pe-3"
        />
      </div>
    </div>
  );
}
