"use client";

import { useActionState } from "react";
import {
  requestPortfolioSummaryPdfAction,
  type RequestPortfolioSummaryPdfState,
  type PortfolioSummaryPdfStatus,
} from "@/lib/reports/actions";

const initialState: RequestPortfolioSummaryPdfState = { error: null };

const STATUS_LABEL: Record<PortfolioSummaryPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/**
 * Round-table market-readiness finding: an admin had no one-click way to get a single PDF summary
 * of the whole portfolio to send a stakeholder — they'd have to compile per-project reports by
 * hand. Queues the render_portfolio_summary_pdf background job (worker/src/jobs/
 * renderPortfolioSummaryPdf.ts) and shows the latest export's status. Same "no client-side
 * polling, reload to see progress" UX as ItpPdfButton / MonthlyReportPackForm — this app has no
 * polling anywhere else either.
 */
export function PortfolioSummaryPdfButton({ latest }: { latest: PortfolioSummaryPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestPortfolioSummaryPdfAction, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {latest?.status === "completed" && latest.pdfUrl && (
          <a
            href={latest.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Download PDF →
          </a>
        )}
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
          >
            {pending ? "Queuing…" : "Export portfolio summary (PDF)"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {!state.error && state.success && (
        <p className="text-xs text-muted">Queued — reload in a moment to download it.</p>
      )}
      {!state.success && latest && latest.status !== "completed" && (
        <p className="text-xs text-muted">
          {STATUS_LABEL[latest.status]}
          {latest.status === "failed" && latest.errorMessage ? ` — ${latest.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}
