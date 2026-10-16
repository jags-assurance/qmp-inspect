"use client";
import { renderingLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect } from "react";
import {
  requestFatReportPdfAction,
  getLatestFatReportPdf,
  type RequestFatReportPdfState,
  type FatReportPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";
import { Tx } from "@/components/domain/tx";
import { Button, buttonVariants } from "@/components/ui/button";

const initialState: RequestFatReportPdfState = { error: null };

const STATUS_LABEL: Record<FatReportPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/** Same trigger/poll/View+Download pattern as ItpPdfButton — see lib/reports/use-pdf-polling.ts. */
export function FatReportPdfButton({ assignmentId, latest }: { assignmentId: string; latest: FatReportPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestFatReportPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestFatReportPdf, assignmentId);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {liveStatus?.status === "completed" && liveStatus.pdfUrl && (
          <a
            href={liveStatus.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Tx>View report →</Tx>
          </a>
        )}
        {liveStatus?.status === "completed" && liveStatus.downloadUrl && (
          <a
            href={liveStatus.downloadUrl}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Tx>Download ↓</Tx>
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="assignment_id" value={assignmentId} />
          <Button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            variant="outline" size="sm"
          >
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : liveStatus ? "Regenerate report" : "Generate report"}
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
