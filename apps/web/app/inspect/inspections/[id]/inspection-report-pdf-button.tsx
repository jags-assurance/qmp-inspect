"use client";

import { useActionState } from "react";
import {
  requestInspectionReportPdfAction,
  type RequestInspectionReportPdfState,
  type InspectionReportPdfStatus,
} from "@/lib/reports/actions";

const initialState: RequestInspectionReportPdfState = { error: null };

const STATUS_LABEL: Record<InspectionReportPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/** Same trigger/status pattern as ItpPdfButton — see that component's header comment. */
export function InspectionReportPdfButton({
  inspectionRecordId,
  latest,
}: {
  inspectionRecordId: string;
  latest: InspectionReportPdfStatus | null;
}) {
  const [state, formAction, pending] = useActionState(requestInspectionReportPdfAction, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {latest?.status === "completed" && latest.pdfUrl && (
          <a
            href={latest.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
          >
            Download report →
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : latest ? "Regenerate report" : "Generate report"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {!state.error && state.success && <p className="text-xs text-muted">Queued — reload in a moment to download it.</p>}
      {!state.success && latest && latest.status !== "completed" && (
        <p className="text-xs text-muted">
          {STATUS_LABEL[latest.status]}
          {latest.status === "failed" && latest.errorMessage ? ` — ${latest.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}
