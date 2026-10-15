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
import { Tx } from "@/components/domain/tx";
import { Button, buttonVariants } from "@/components/ui/button";

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
        {completed && (
        <form action={formAction}>
          <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
          <Button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            variant="outline" size="sm"
          >
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : liveStatus ? "Regenerate report" : "Generate report"}
          </Button>
        </form>
        )}
      </div>
      {!completed && <p className="text-xs text-muted"><Tx>The report can be generated once the inspection is completed.</Tx></p>}
      {completed && liveStatus?.status === "completed" && signedAt && Date.parse(liveStatus.createdAt) < Date.parse(signedAt) && (
        <p className="text-xs font-medium text-warning" role="status"><Tx>This report was generated before the latest sign-off — regenerate it.</Tx></p>
      )}
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
