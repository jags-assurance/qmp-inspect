"use client";
import { generateButtonLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect, type ReactNode } from "react";
import { requestItpPdfAction, getLatestItpPdf, type RequestItpPdfState, type ItpPdfStatus } from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tx } from "@/components/domain/tx";
import { buttonVariants } from "@/components/ui/button";

const initialState: RequestItpPdfState = { error: null };

const STATUS_LABEL: Record<ItpPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/**
 * Triggers the render_itp_pdf background job. Polls getLatestItpPdf (via the shared usePdfPolling
 * hook — see lib/reports/use-pdf-polling.ts) until the job the user just queued completes or fails,
 * so the View/Download links appear on their own instead of requiring a manual page reload.
 *
 * One primary action (View PDF, shown only once one exists) plus a single "⋯ More" dropdown for
 * every other document action on this ITP — Download PDF, Generate/Regenerate, and whatever the
 * caller passes as `extraActions` (page.tsx's Word/.xlsx export links). Previously five co-equal
 * buttons in a row regardless of state; this was the reported "so many buttons, confusing" page.
 */
export function ItpPdfButton({
  itpId,
  latest,
  extraActions,
}: {
  itpId: string;
  latest: ItpPdfStatus | null;
  /** Additional document-action rows (Word export, offline .xlsx export, ...) rendered inside this
   *  same dropdown — kept as a slot rather than hardcoded here since those exports aren't PDF jobs
   *  and don't belong in this component's own concerns otherwise. */
  extraActions?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(requestItpPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestItpPdf, itpId);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  const isReady = liveStatus?.status === "completed" && !!liveStatus.pdfUrl;
  const inFlight = polling || liveStatus?.status === "pending" || liveStatus?.status === "processing";
  const generateLabel = generateButtonLabel({ submitting: pending, polling, job: liveStatus });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {isReady && liveStatus?.pdfUrl && (
          <a
            href={liveStatus.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants()}
          >
            <Tx>View PDF →</Tx>
          </a>
        )}
        <DropdownMenu label="⋯ More" align="end">
          {isReady && liveStatus?.downloadUrl && (
            <DropdownMenuItem>
              <a href={liveStatus.downloadUrl}><Tx>Download PDF ↓</Tx></a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem>
            <form action={formAction}>
              <input type="hidden" name="itp_id" value={itpId} />
              <button type="submit" onClick={beginGenerate} disabled={pending || inFlight}>
                {generateLabel}
              </button>
            </form>
          </DropdownMenuItem>
          {extraActions}
        </DropdownMenu>
      </div>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {polling && <p className="text-xs text-muted"><Tx>Rendering — check &ldquo;⋯ More&rdquo; in a moment for the finished PDF…</Tx></p>}
      {timedOut && (
        <p className="text-xs text-danger">
          <Tx>Still rendering after 2 minutes — the PDF worker may be slow or stuck. Try &ldquo;Regenerate PDF&rdquo; again shortly, or reload this page to check whether it finished anyway.</Tx>
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
