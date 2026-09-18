"use client";

import { useActionState, useEffect } from "react";
import { requestItpPdfAction, getLatestItpPdf, type RequestItpPdfState, type ItpPdfStatus } from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";

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
 */
export function ItpPdfButton({ itpId, latest }: { itpId: string; latest: ItpPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestItpPdfAction, initialState);
  const { liveStatus, polling, beginGenerate, startPolling } = usePdfPolling(latest, getLatestItpPdf, itpId);

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
            Download PDF ↓
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="itp_id" value={itpId} />
          <button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : polling ? "Rendering…" : liveStatus ? "Regenerate PDF" : "Generate PDF"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {polling && <p className="text-xs text-muted">Rendering — the links above will appear automatically when ready…</p>}
      {!polling && !state.error && liveStatus && liveStatus.status !== "completed" && (
        <p className="text-xs text-muted">
          {STATUS_LABEL[liveStatus.status]}
          {liveStatus.status === "failed" && liveStatus.errorMessage ? ` — ${liveStatus.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}
