"use client";
import { renderingLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect } from "react";
import {
  requestInspectionReportPdfAction,
  getLatestInspectionReportPdf,
  type RequestInspectionReportPdfState,
  type InspectionReportPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";

const initialState: RequestInspectionReportPdfState = { error: null };

const STATUS_LABEL: Record<InspectionReportPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/** Same trigger/poll/View+Download pattern as ItpPdfButton — see lib/reports/use-pdf-polling.ts. */
export function InspectionReportPdfButton({
  inspectionRecordId,
  latest,
  completed = true,
  signedAt = null,
}: {
  inspectionRecordId: string;
  latest: InspectionReportPdfStatus | null;
  /** The inspection has a recorded result; a report can only be generated then. */
  completed?: boolean;
  /** When the result was signed: a report rendered before this describes an older state. */
  signedAt?: string | null;
}) {
  const [state, formAction, pending] = useActionState(requestInspectionReportPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestInspectionReportPdf, inspectionRecordId);

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
        {completed && (
        <form action={formAction}>
          <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
          <button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : liveStatus ? "Regenerate report" : "Generate report"}
          </button>
        </form>
        )}
      </div>
      {!completed && <p className="text-xs text-muted">The report can be generated once the inspection is completed.</p>}
      {completed && liveStatus?.status === "completed" && signedAt && Date.parse(liveStatus.createdAt) < Date.parse(signedAt) && (
        <p className="text-xs font-medium text-warning" role="status">This report was generated before the latest sign-off — regenerate it.</p>
      )}
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
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
