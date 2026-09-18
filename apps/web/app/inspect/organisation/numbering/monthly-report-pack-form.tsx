"use client";

import { useActionState, useEffect } from "react";
import {
  generateMonthlyReportPackAction,
  listMonthlyReportPacks,
  type GenerateMonthlyReportPackState,
  type ReportPackListItem,
} from "@/lib/reports/actions";
import { useReportPackListPolling } from "@/lib/reports/use-report-pack-polling";
import { REPORT_PACK_STATUS_LABEL } from "@/lib/reports/status-labels";
import { Button } from "@/components/ui/button";

const initialState: GenerateMonthlyReportPackState = { error: null };

const MONTH_OPTIONS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, i) => ({ label, value: i + 1 }));
const MONTH_NAMES = MONTH_OPTIONS.map((m) => m.label);

/**
 * Previously: the "Generate monthly report pack" button told the admin to "refresh this page to
 * see it appear below once it completes" — a literal manual-reload requirement, the same bug family
 * as the four PDF buttons fixed earlier (see lib/reports/use-pdf-polling.ts's doc comment). This
 * owns both the queue form and the generated-packs table so a successful queue can start polling
 * listMonthlyReportPacks (via the shared list-polling hook) until the new pack's row updates itself
 * with real View + Download links.
 */
export function MonthlyReportPackForm({ organizationId, initialPacks }: { organizationId: string; initialPacks: ReportPackListItem[] }) {
  const [state, formAction, pending] = useActionState(generateMonthlyReportPackAction, initialState);
  const { items: reportPacks, polling, startPolling } = useReportPackListPolling(initialPacks, listMonthlyReportPacks, organizationId);
  const now = new Date();

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organization_id" value={organizationId} />

        <div>
          <label className="block text-xs text-muted">Month</label>
          <select
            name="month"
            defaultValue={now.getMonth() + 1}
            className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted">Year</label>
          <input
            name="year"
            type="number"
            min={2020}
            max={2100}
            defaultValue={now.getFullYear()}
            className="mt-1 w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <Button type="submit" disabled={pending || polling}>
          {pending ? "Queuing…" : polling ? "Rendering…" : "Generate monthly report pack"}
        </Button>

        {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
        {polling && <p className="w-full text-sm text-muted">Rendering — the table below updates automatically when ready…</p>}
      </form>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Generated report packs</h3>
      {reportPacks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No report packs generated yet for this organisation.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="py-2">Period</th>
              <th className="py-2">Status</th>
              <th className="py-2">Requested</th>
              <th className="py-2">Download</th>
            </tr>
          </thead>
          <tbody>
            {reportPacks.map((pack) => (
              <tr key={pack.id} className="border-b border-border last:border-0">
                <td className="py-2">
                  {MONTH_NAMES[pack.month - 1]} {pack.year}
                </td>
                <td className="py-2">{REPORT_PACK_STATUS_LABEL[pack.status] ?? pack.status}</td>
                <td className="py-2 text-xs text-muted">{new Date(pack.createdAt).toLocaleString()}</td>
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
                      {pack.csvDownloadUrl && (
                        <a href={pack.csvDownloadUrl} className="text-burgundy underline">
                          Download CSV
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
        </table>
      )}
    </div>
  );
}
