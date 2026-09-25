"use client";

import { useActionState, useEffect } from "react";
import {
  requestPortfolioSummaryPdfAction,
  getLatestPortfolioSummaryPdf,
  type RequestPortfolioSummaryPdfState,
  type PortfolioSummaryPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";

const initialState: RequestPortfolioSummaryPdfState = { error: null };

const STATUS_LABEL: Record<PortfolioSummaryPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

// getLatestPortfolioSummaryPdf takes no id argument (it's scoped to the current session) —
// module-level (not an inline arrow inside the component) so it's a stable reference across
// renders, matching usePdfPolling's requirement that fetchLatest never change identity.
function fetchLatestPortfolioSummary(): Promise<PortfolioSummaryPdfStatus | null> {
  return getLatestPortfolioSummaryPdf();
}

/**
 * Round-table market-readiness finding: an admin had no one-click way to get a single PDF summary
 * of the whole portfolio to send a stakeholder — they'd have to compile per-project reports by
 * hand. Queues the render_portfolio_summary_pdf background job (worker/src/jobs/
 * renderPortfolioSummaryPdf.ts) and shows the latest export's status. Same trigger/poll/View+Download
 * pattern as ItpPdfButton — see lib/reports/use-pdf-polling.ts.
 */
export function PortfolioSummaryPdfButton({ latest }: { latest: PortfolioSummaryPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestPortfolioSummaryPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, fetchLatestPortfolioSummary, null);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {liveStatus?.status === "completed" && liveStatus.pdfUrl && (
          <a
            href={liveStatus.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            View PDF →
          </a>
        )}
        {liveStatus?.status === "completed" && liveStatus.downloadUrl && (
          <a
            href={liveStatus.downloadUrl}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Download ↓
          </a>
        )}
        <form action={formAction}>
          <button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
          >
            {pending ? "Queuing…" : polling ? "Rendering…" : "Export portfolio summary (PDF)"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {polling && <p className="text-xs text-muted">Rendering — the links above will appear automatically when ready…</p>}
      {timedOut && (
        <p className="text-xs text-danger">
          Still rendering after 2 minutes — try again shortly, or reload this page to check whether it finished anyway.
        </p>
      )}
      {!polling && !state.error && liveStatus && liveStatus.status !== "completed" && (
        <p className="text-xs text-muted">
          {STATUS_LABEL[liveStatus.status]}
          {liveStatus.status === "failed" && liveStatus.errorMessage ? ` — ${liveStatus.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}
