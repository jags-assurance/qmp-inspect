"use client";

import { useActionState } from "react";
import { requestItpPdfAction, type RequestItpPdfState, type ItpPdfStatus } from "@/lib/reports/actions";

const initialState: RequestItpPdfState = { error: null };

const STATUS_LABEL: Record<ItpPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

/**
 * Triggers the render_itp_pdf background job and shows the latest render's status — the worker
 * side of this (worker/src/jobs/renderItpPdf.ts) already builds the exact controlled A4 document
 * from the Prototype Brief / final-ITP reference; this was the missing UI to actually reach it.
 * No client-side polling (same as the monthly report pack form) — reload the page to see progress.
 */
export function ItpPdfButton({ itpId, latest }: { itpId: string; latest: ItpPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestItpPdfAction, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {latest?.status === "completed" && latest.pdfUrl && (
          <a
            href={latest.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
          >
            Download PDF →
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="itp_id" value={itpId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : latest ? "Regenerate PDF" : "Generate PDF"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {!state.error && state.success && (
        <p className="text-xs text-muted">Queued — reload in a moment to download it.</p>
      )}
      {!state.success && latest && latest.status !== "completed" && (
        <p className="text-xs text-muted">
          {STATUS_LABEL[latest.status]}
          {latest.status === "failed" && latest.errorMessage ? ` — ${latest.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}
