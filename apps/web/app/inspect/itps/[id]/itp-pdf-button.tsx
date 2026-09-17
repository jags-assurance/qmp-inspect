"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { requestItpPdfAction, getLatestItpPdf, type RequestItpPdfState, type ItpPdfStatus } from "@/lib/reports/actions";

const initialState: RequestItpPdfState = { error: null };

const STATUS_LABEL: Record<ItpPdfStatus["status"], string> = {
  pending: "Queued…",
  processing: "Rendering…",
  completed: "Ready",
  failed: "Failed",
};

// Worker renders in ~5-10s in practice (see renderItpPdf.ts) — poll faster than that so "click
// Generate → the download link just appears" feels immediate, but stop well short of the worker's
// own 3-minute JOB_TIMEOUT_MS so a genuinely stuck job doesn't poll forever in the background.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 60;

/**
 * Triggers the render_itp_pdf background job. Polls getLatestItpPdf directly (no dedicated
 * polling endpoint needed — it's already a plain server action) until the job the user just
 * queued completes or fails, so the download link appears on its own instead of requiring a
 * manual page reload.
 */
export function ItpPdfButton({ itpId, latest }: { itpId: string; latest: ItpPdfStatus | null }) {
  const [state, formAction, pending] = useActionState(requestItpPdfAction, initialState);
  const [liveStatus, setLiveStatus] = useState<ItpPdfStatus | null>(latest);
  const [polling, setPolling] = useState(false);
  const pollCountRef = useRef(0);
  const autoOpenedRef = useRef(false);
  // A window.open() called from inside the async polling effect, seconds after the click, has lost
  // "user activation" and gets silently blocked by every major browser (verified live — it returns
  // null, no console warning). The fix: open a blank tab synchronously inside the click handler
  // itself, while it still counts as a direct result of the click, and just redirect that
  // already-open tab's location once the PDF is ready — browsers don't block that.
  const pendingWindowRef = useRef<Window | null>(null);

  function handleGenerateClick() {
    pendingWindowRef.current = window.open("", "_blank");
  }

  useEffect(() => {
    if (!state.success) return;
    setPolling(true);
    pollCountRef.current = 0;
    autoOpenedRef.current = false;
  }, [state.success]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      pollCountRef.current += 1;
      const next = await getLatestItpPdf(itpId);
      if (cancelled) return;
      setLiveStatus(next);
      if (next?.status === "completed" || next?.status === "failed" || pollCountRef.current >= MAX_POLLS) {
        setPolling(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling, itpId]);

  // Open the freshly-rendered PDF the moment it's ready, once, instead of making the user find and
  // click the Download link themselves after watching it appear.
  useEffect(() => {
    if (liveStatus?.status === "completed" && liveStatus.pdfUrl && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      const tab = pendingWindowRef.current;
      if (tab && !tab.closed) {
        tab.location.href = liveStatus.pdfUrl;
      } else {
        // The click-time window.open() can itself come back null (popups fully disabled, or this
        // page loaded outside a real click e.g. during dev tooling) — fall back to a normal link
        // click's worth of effort rather than silently doing nothing.
        window.open(liveStatus.pdfUrl, "_blank", "noopener,noreferrer");
      }
    } else if (liveStatus?.status === "failed" && pendingWindowRef.current && !pendingWindowRef.current.closed) {
      // Don't leave a blank about:blank tab sitting around when the render failed.
      pendingWindowRef.current.close();
    }
  }, [liveStatus]);

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
            Download PDF →
          </a>
        )}
        <form action={formAction}>
          <input type="hidden" name="itp_id" value={itpId} />
          <button
            type="submit"
            onClick={handleGenerateClick}
            disabled={pending || polling}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
          >
            {pending ? "Queuing…" : polling ? "Rendering…" : liveStatus ? "Regenerate PDF" : "Generate PDF"}
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {polling && <p className="text-xs text-muted">Rendering — it'll open automatically when ready…</p>}
      {!polling && !state.error && liveStatus && liveStatus.status !== "completed" && (
        <p className="text-xs text-muted">
          {STATUS_LABEL[liveStatus.status]}
          {liveStatus.status === "failed" && liveStatus.errorMessage ? ` — ${liveStatus.errorMessage}` : ""}
        </p>
      )}
    </div>
  );
}
