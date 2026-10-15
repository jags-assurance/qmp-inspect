"use client";
import { renderingLabel, jobStatusText, isPdfStale } from "@/lib/reports/pdf-job-labels";

import { useActionState, useEffect } from "react";
import {
  requestIrnPdfAction,
  getLatestIrnPdf,
  type RequestIrnPdfState,
  type IrnPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";
import { Tx } from "@/components/domain/tx";
import { Button, buttonVariants } from "@/components/ui/button";

const initialState: RequestIrnPdfState = { error: null };

const STATUS_LABEL: Record<IrnPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/** Same trigger/poll/View+Download pattern as NcrPdfButton — see lib/reports/use-pdf-polling.ts. */
export function IrnPdfButton({
  irnId,
  latest,
  changedAt = null,
}: {
  irnId: string;
  latest: IrnPdfStatus | null;
  /** When the inspection result behind this IRN was last signed: a certificate rendered before this is outdated. */
  changedAt?: string | null;
}) {
  const [state, formAction, pending] = useActionState(requestIrnPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestIrnPdf, irnId);

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
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Tx>View certificate →</Tx>
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
          <input type="hidden" name="irn_id" value={irnId} />
          <Button
            type="submit"
            onClick={beginGenerate}
            disabled={pending || polling}
            variant="outline" size="sm"
          >
            {pending ? "Queuing…" : polling ? renderingLabel(liveStatus) : liveStatus ? "Regenerate PDF" : "Generate PDF"}
          </Button>
        </form>
      </div>
      {liveStatus?.status === "completed" && !polling && isPdfStale(liveStatus.createdAt, changedAt) && (
        <p className="text-xs font-medium text-warning" role="status">
          <Tx>This certificate was generated before the latest sign-off on this inspection - regenerate it.</Tx>
        </p>
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
