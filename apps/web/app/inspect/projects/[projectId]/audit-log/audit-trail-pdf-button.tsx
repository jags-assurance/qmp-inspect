"use client";
import { renderingLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect } from "react";
import {
  requestAuditTrailPdfAction,
  getLatestAuditTrailPdf,
  type RequestAuditTrailPdfState,
  type AuditTrailPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";
import { Tx } from "@/components/domain/tx";

const initialState: RequestAuditTrailPdfState = { error: null };

/** Same trigger/poll/View+Download pattern as NcrPdfButton; sends the page's current filters with the request. */
export function AuditTrailPdfButton({
  projectId,
  range,
  cat,
  actor,
  latest,
}: {
  projectId: string;
  range?: string;
  cat?: string;
  actor?: string;
  latest: AuditTrailPdfStatus | null;
}) {
  const [state, formAction, pending] = useActionState(requestAuditTrailPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestAuditTrailPdf, projectId);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  const linkCls = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-subtle [@media(pointer:coarse)]:min-h-11";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {liveStatus?.status === "completed" && liveStatus.pdfUrl && (
          <a href={liveStatus.pdfUrl} target="_blank" rel="noreferrer" className={linkCls}>
            <Tx>View PDF →</Tx>
          </a>
        )}
        {liveStatus?.status === "completed" && liveStatus.downloadUrl && (
          <a href={liveStatus.downloadUrl} className={linkCls}>
            <Tx>Download PDF ↓</Tx>
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="range" value={range ?? ""} />
          <input type="hidden" name="cat" value={cat ?? ""} />
          <input type="hidden" name="actor" value={actor ?? ""} />
          <button type="submit" onClick={beginGenerate} disabled={pending || polling} className={`${linkCls} disabled:opacity-50`}>
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : liveStatus ? "Regenerate PDF" : "Export PDF"}
          </button>
        </form>
      </div>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {polling && <p className="text-xs text-muted"><Tx>Rendering — the links will appear automatically when ready…</Tx></p>}
      {timedOut && <p className="text-xs text-danger"><Tx>Still rendering after a few minutes — reload this page to check whether it finished.</Tx></p>}
      {!polling && !state.error && liveStatus && liveStatus.status !== "completed" && <p className="text-xs text-muted">{jobStatusText(liveStatus)}</p>}
      {liveStatus?.status === "completed" && !polling && (
        <p className="text-xs text-muted"><Tx>Your last PDF export is shown; regenerate to apply the current filters. PDFs list at most 5,000 events and say so if cut; the CSV has no limit.</Tx></p>
      )}
    </div>
  );
}
