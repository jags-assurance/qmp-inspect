"use client";
import { renderingLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect } from "react";
import {
  requestNcrPdfAction,
  getLatestNcrPdf,
  type RequestNcrPdfState,
  type NcrPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";

const initialState: RequestNcrPdfState = { error: null };

const STATUS_LABEL: Record<NcrPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/** Same trigger/poll/View+Download pattern as FatReportPdfButton — see lib/reports/use-pdf-polling.ts. */
export function NcrPdfButton({ ncrId, latest }: { ncrId: string; latest: NcrPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestNcrPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestNcrPdf, ncrId);

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
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
          >
            View report →
          </a>
        )}
        {liveStatus?.status === "completed" && liveStatus.downloadUrl && (
          <a
            href={liveStatus.downloadUrl}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
          >
            Download ↓
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="ncr_id" value={ncrId} />
          <button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : liveStatus ? "Regenerate PDF" : "Generate PDF"}
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
          {jobStatusText(liveStatus)}
        </p>
      )}
    </div>
  );
}
