"use client";

import { useActionState, useEffect } from "react";
import {
  requestWeeklyReportPackAction,
  listWeeklyReportPacks,
  type RequestWeeklyReportPackState,
  type WeeklyReportPackListItem,
} from "@/lib/reports/actions";
import { useReportPackListPolling } from "@/lib/reports/use-report-pack-polling";
import { REPORT_PACK_STATUS_LABEL } from "@/lib/reports/status-labels";
import { Button } from "@/components/ui/button";

const initialState: RequestWeeklyReportPackState = { error: null };

/** Monday of the current week, as a YYYY-MM-DD string — a sensible default "week starting" date. */
function defaultWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  return monday.toISOString().slice(0, 10);
}

/** Same polling/View+Download fix as MonthlyReportPackForm — see its doc comment. */
export function WeeklyReportPackForm({ organizationId, initialPacks }: { organizationId: string; initialPacks: WeeklyReportPackListItem[] }) {
  const [state, formAction, pending] = useActionState(requestWeeklyReportPackAction, initialState);
  const { items: weeklyReportPacks, polling, startPolling } = useReportPackListPolling(initialPacks, listWeeklyReportPacks, organizationId);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organization_id" value={organizationId} />

        <div>
          <label className="block text-xs text-muted">Week starting</label>
          <input
            name="week_start"
            type="date"
            defaultValue={defaultWeekStart()}
            className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <Button type="submit" disabled={pending || polling}>
          {pending ? "Queuing…" : polling ? "Rendering…" : "Generate weekly report pack"}
        </Button>

        {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
        {polling && <p className="w-full text-sm text-muted">Rendering — the table below updates automatically when ready…</p>}
      </form>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Generated report packs</h3>
      {weeklyReportPacks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No report packs generated yet for this organisation.</p>
      ) : (
        <div className="overflow-x-auto"><table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="py-2">Week</th>
              <th className="py-2">Status</th>
              <th className="py-2">Requested</th>
              <th className="py-2">Download</th>
            </tr>
          </thead>
          <tbody>
            {weeklyReportPacks.map((pack) => (
              <tr key={pack.id} className="border-b border-border last:border-0">
                <td className="py-2">Week of {pack.weekStart}</td>
                <td className="py-2">{REPORT_PACK_STATUS_LABEL[pack.status] ?? pack.status}</td>
                <td className="py-2 text-xs text-muted">{new Date(pack.createdAt).toLocaleString("en-GB")}</td>
                <td className="py-2">
                  {pack.status === "completed" && pack.pdfUrl ? (
                    <span className="flex flex-wrap gap-3">
                      <a href={pack.pdfUrl} target="_blank" rel="noreferrer" className="text-burgundy underline">
                        View PDF
                      </a>
                      {pack.pdfDownloadUrl && (
                        <a href={pack.pdfDownloadUrl} className="text-burgundy underline">
                          Download PDF
                        </a>
                      )}
                      {pack.xlsxDownloadUrl && (
                        <a href={pack.xlsxDownloadUrl} className="text-burgundy underline">
                          Download Excel
                        </a>
                      )}
                    </span>
                  ) : pack.status === "failed" ? (
                    <span className="text-xs text-danger">{pack.errorMessage ?? "Failed"}</span>
                  ) : (
                    <span className="text-xs text-muted">Rendering…</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
