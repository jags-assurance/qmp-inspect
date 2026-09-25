"use client";

import { useActionState, useEffect } from "react";
import {
  requestDataBookPdfAction,
  getLatestDataBookPdf,
  type RequestDataBookPdfState,
  type DataBookPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";

const initialState: RequestDataBookPdfState = { error: null };

const STATUS_LABEL: Record<DataBookPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/** Same trigger/poll/View+Download pattern as NcrPdfButton — see lib/reports/use-pdf-polling.ts. */
export function DataBookPdfButton({
  dataBookId,
  projectId,
  latest,
}: {
  dataBookId: string;
  projectId: string;
  latest: DataBookPdfStatus | null;
}) {
  const [state, formAction, pending] = useActionState(requestDataBookPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestDataBookPdf, dataBookId);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-2">
        {liveStatus?.status === "completed" && liveStatus.pdfUrl && (
          <a
            href={liveStatus.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
          >
            View PDF →
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
          <input type="hidden" name="data_book_id" value={dataBookId} />
          <input type="hidden" name="project_id" value={projectId} />
          <button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : polling ? "Rendering…" : liveStatus ? "Regenerate PDF" : "Generate PDF"}
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
