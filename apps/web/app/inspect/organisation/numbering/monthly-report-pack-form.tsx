"use client";

import { useActionState, useEffect, useState } from "react";
import {
  generateMonthlyReportPackAction,
  generateReportPackSummaryAction,
  listMonthlyReportPacks,
  type GenerateMonthlyReportPackState,
  type GenerateReportSummaryState,
  type ReportPackListItem,
} from "@/lib/reports/actions";
import { useReportPackListPolling } from "@/lib/reports/use-report-pack-polling";
import { REPORT_PACK_STATUS_LABEL } from "@/lib/reports/status-labels";
import { Button } from "@/components/ui/button";

const initialState: GenerateMonthlyReportPackState = { error: null };
const summaryInitialState: GenerateReportSummaryState = { error: null, summary: null };

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
export function MonthlyReportPackForm({
  organizationId,
  initialPacks,
  aiConfigured,
}: {
  organizationId: string;
  initialPacks: ReportPackListItem[];
  /** R111: honest "AI not configured" gate (R43's pattern) for the AI executive-summary button
   *  below — see isAiConfigured() in lib/ai/gate.ts. */
  aiConfigured?: boolean;
}) {
  const [state, formAction, pending] = useActionState(generateMonthlyReportPackAction, initialState);
  const [summaryState, summaryFormAction, summaryPending] = useActionState(generateReportPackSummaryAction, summaryInitialState);
  const { items: reportPacks, polling, startPolling } = useReportPackListPolling(initialPacks, listMonthlyReportPacks, organizationId);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="year" value={year} />

        <div>
          <label className="block text-xs text-muted">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
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
            type="number"
            min={2020}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <Button type="submit" disabled={pending || polling}>
          {pending ? "Queuing…" : polling ? "Rendering…" : "Generate monthly report pack"}
        </Button>

        {aiConfigured && (
          <button
            type="button"
            disabled={summaryPending}
            onClick={() => {
              const fd = new FormData();
              fd.set("organization_id", organizationId);
              fd.set("month", String(month));
              fd.set("year", String(year));
              summaryFormAction(fd);
            }}
            className="rounded-md border border-border bg-off-white px-3 py-2 text-sm font-medium hover:bg-surface disabled:opacity-50"
          >
            {summaryPending ? "Summarising…" : "Generate AI summary"}
          </button>
        )}

        {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
        {polling && <p className="w-full text-sm text-muted">Rendering — the table below updates automatically when ready…</p>}
      </form>

      {aiConfigured && (
        <>
          {summaryState.error && <p className="mt-2 text-sm text-danger">{summaryState.error}</p>}
          {summaryState.summary && (
            <div className="mt-3 rounded-md border border-border bg-off-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                AI executive summary — {MONTH_NAMES[month - 1]} {year} (display only, not embedded in the PDF)
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{summaryState.summary}</p>
            </div>
          )}
        </>
      )}

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
        </table>
      )}
    </div>
  );
}
