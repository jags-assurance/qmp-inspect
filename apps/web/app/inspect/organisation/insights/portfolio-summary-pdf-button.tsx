"use client";
import { renderingLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect } from "react";
import {
  requestPortfolioSummaryPdfAction,
  getLatestPortfolioSummaryPdf,
  type RequestPortfolioSummaryPdfState,
  type PortfolioSummaryPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";
import { Tx } from "@/components/domain/tx";
import { Button, buttonVariants } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const keepValuesSubmit = useKeepFormValues(state, formAction);
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
            className={buttonVariants({ variant: "outline" })}
          >
            <Tx>View PDF →</Tx>
          </a>
        )}
        {liveStatus?.status === "completed" && liveStatus.downloadUrl && (
          <a
            href={liveStatus.downloadUrl}
            className={buttonVariants({ variant: "outline" })}
          >
            <Tx>Download ↓</Tx>
          </a>
        )}
        <form onSubmit={keepValuesSubmit}>
          <Button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            
          >
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : "Export portfolio summary (PDF)"}
          </Button>
        </form>
      </div>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {polling && <p className="text-xs text-muted"><Tx>Rendering — the links above will appear automatically when ready…</Tx></p>}
      {timedOut && (
        <p className="text-xs text-danger">
          <Tx>Still rendering after 2 minutes — try again shortly, or reload this page to check whether it finished anyway.</Tx>
        </p>
      )}
      {!polling && !state.error && liveStatus && liveStatus.status !== "completed" && (
        <p className="text-xs text-muted">
          {jobStatusText(liveStatus)}

        </p>
      )}
    </div>
  );
}
