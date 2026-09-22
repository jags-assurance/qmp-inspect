import { Badge } from "@/components/ui/badge";
import type { DataBookDisciplineRow } from "@/lib/databook/discipline-breakdown";

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

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Discipline</th>
              <th className="py-2 pr-3 font-medium">ITPs</th>
              <th className="py-2 pr-3 font-medium">NCRs</th>
              <th className="py-2 pr-3 font-medium">First-time pass rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.disciplineCode} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <span className="font-medium text-ink">{row.disciplineName}</span>
                  <span className="ml-2 text-xs text-muted">{row.disciplineCode}</span>
                </td>
                <td className="py-2 pr-3 text-ink">{row.itpCount}</td>
                <td className="py-2 pr-3">
                  <Badge tone={row.ncrCount === 0 ? "success" : "warning"}>{row.ncrCount}</Badge>
                </td>
                <td className="py-2 pr-3 text-ink">
                  {row.firstTimePassRate === null ? (
                    <span className="text-muted">No inspections yet</span>
                  ) : (
                    <>
                      <Badge tone={row.firstTimePassRate === 100 ? "success" : row.firstTimePassRate >= 80 ? "warning" : "danger"}>
                        {row.firstTimePassRate}%
                      </Badge>
                      <span className="ml-2 text-xs text-muted">
                        {row.firstTimePasses}/{row.firstAttempts}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
