"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  requestDataBookPdfAction,
  getLatestDataBookPdf,
  type RequestDataBookPdfState,
  type DataBookPdfStatus,
} from "@/lib/reports/actions";
import { usePdfPolling } from "@/lib/reports/use-pdf-polling";
import { Button } from "@/components/ui/button";

const initialState: RequestDataBookPdfState = { error: null };

const STATUS_LABEL: Record<DataBookPdfStatus["status"], string> = {
  pending: "Queued",
  processing: "Rendering",
  completed: "Ready",
  failed: "Failed",
};

/** In-page PDF viewer (iframe on the short-lived signed URL) with an open-in-new-tab fallback. */
function PdfViewerDialog({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-black/60 p-2 sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-surface shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="text-sm text-burgundy hover:underline">
              Open in new tab ↗
            </a>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-off-white focus:outline-none focus:ring-2 focus:ring-burgundy"
            >
              Close
            </button>
          </div>
        </div>
        <iframe src={url} title={title} className="min-h-0 flex-1 bg-white" />
        <p className="border-t border-border px-4 py-1.5 text-xs text-muted">
          If the document does not display here (some mobile browsers), use &quot;Open in new tab&quot;.
        </p>
      </div>
    </div>
  );
}

/** Same trigger/poll/View+Download pattern as NcrPdfButton — see lib/reports/use-pdf-polling.ts. */
export function DataBookPdfButton({
  dataBookId,
  projectId,
  latest,
  generateLabel,
  isDraftBook = false,
}: {
  dataBookId: string;
  projectId: string;
  latest: DataBookPdfStatus | null;
  generateLabel?: string;
  isDraftBook?: boolean;
}) {
  const [state, formAction, pending] = useActionState(requestDataBookPdfAction, initialState);
  const { liveStatus, polling, timedOut, beginGenerate, startPolling } = usePdfPolling(latest, getLatestDataBookPdf, dataBookId);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  const ready = liveStatus?.status === "completed";
  const failed = liveStatus?.status === "failed";
  const idleLabel = failed ? "Retry PDF" : liveStatus ? "Regenerate PDF" : (generateLabel ?? "Generate PDF");

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-2">
        {ready && liveStatus.pdfUrl && (
          <Button type="button" size="sm" onClick={() => setViewing(true)}>
            View
          </Button>
        )}
        {ready && liveStatus.downloadUrl && (
          <a
            href={liveStatus.downloadUrl}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
          >
            Download PDF ↓
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="data_book_id" value={dataBookId} />
          <input type="hidden" name="project_id" value={projectId} />
          <Button type="submit" size="sm" variant="outline" onClick={beginGenerate} disabled={pending || polling}>
            {pending ? "Queuing…" : polling ? "Rendering…" : idleLabel}
          </Button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger" role="alert">{state.error}</p>}
      <p className="text-xs text-muted" aria-live="polite">
        {liveStatus ? (
          <>
            PDF job: <span className="font-medium">{STATUS_LABEL[liveStatus.status]}</span>
            {" · "}
            {new Date(liveStatus.createdAt).toLocaleString("en-GB")}
            {isDraftBook && ready ? " · DRAFT — not issued" : ""}
            {failed && liveStatus.errorMessage ? ` — ${liveStatus.errorMessage}` : ""}
          </>
        ) : (
          "No PDF generated yet."
        )}
      </p>
      {polling && <p className="text-xs text-muted">Rendering — View and Download appear automatically when ready…</p>}
      {timedOut && (
        <p className="text-xs text-danger">
          Still rendering after 2 minutes — try again shortly, or reload this page to check whether it finished anyway.
        </p>
      )}
      {viewing && ready && liveStatus.pdfUrl && (
        <PdfViewerDialog url={liveStatus.pdfUrl} title={isDraftBook ? "Data Book (DRAFT)" : "Data Book"} onClose={() => setViewing(false)} />
      )}
    </div>
  );
}
