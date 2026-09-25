"use client";

import { useEffect, useRef, useState } from "react";

export interface PdfStatusLike {
  status: "pending" | "processing" | "completed" | "failed";
  pdfUrl: string | null;
  downloadUrl?: string | null;
  errorMessage: string | null;
}

// Worker renders in ~5-10s in practice — poll faster than that so "click Generate → the links just
// appear" feels immediate, but stop well short of the worker's own 3-minute JOB_TIMEOUT_MS so a
// genuinely stuck job doesn't poll forever in the background.
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 60;

/**
 * Shared "queue a background PDF render, then wait for it" behaviour for every PDF/report button in
 * this app (ItpPdfButton, InspectionReportPdfButton, FatReportPdfButton, PortfolioSummaryPdfButton).
 * Previously only ItpPdfButton had this — the other three told the user "reload in a moment to
 * download it" and required a manual page refresh to ever see the link, which is exactly the "must
 * not act like a reload" gap this closes. Pulled out once so all four behave identically going
 * forward instead of drifting.
 *
 * fetchLatest must be a stable function reference (a module-level server action export, not an
 * inline arrow — inline functions would restart the polling interval's effect on every render).
 */
export function usePdfPolling<T extends PdfStatusLike, Id>(initialLatest: T | null, fetchLatest: (id: Id) => Promise<T | null>, id: Id) {
  const [liveStatus, setLiveStatus] = useState<T | null>(initialLatest);
  const [polling, setPolling] = useState(false);
  // Hitting MAX_POLLS while the job is still pending/processing used to just stop polling in
  // silence — no error, no close on the blank tab window.open() left sitting there — so the user's
  // only visible symptom was a permanently blank about:blank tab with nothing telling them
  // anything went wrong (reported: "generate itp pdf... redirects to other page... pdf is not
  // generated" — that "redirect" was this blank tab, never resolving). Now a genuine "reached the
  // client-side timeout" case, distinct from failed (the job errored) and completed.
  const [timedOut, setTimedOut] = useState(false);
  const pollCountRef = useRef(0);
  const autoOpenedRef = useRef(false);
  // A window.open() called from inside the async polling effect, seconds after the click, has lost
  // "user activation" and gets silently blocked by every major browser. The fix: open a blank tab
  // synchronously inside the click handler itself, while it still counts as a direct result of the
  // click, and just redirect that already-open tab's location once the PDF is ready — browsers
  // don't block that.
  const pendingWindowRef = useRef<Window | null>(null);

  function beginGenerate() {
    pendingWindowRef.current = window.open("", "_blank");
  }

  function startPolling() {
    setPolling(true);
    setTimedOut(false);
    pollCountRef.current = 0;
    autoOpenedRef.current = false;
  }

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      pollCountRef.current += 1;
      const next = await fetchLatest(id);
      if (cancelled) return;
      setLiveStatus(next);
      const settled = next?.status === "completed" || next?.status === "failed";
      if (settled || pollCountRef.current >= MAX_POLLS) {
        setPolling(false);
        if (!settled) setTimedOut(true);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // fetchLatest is documented as a stable module-level reference; id is the only real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, id]);

  // Open the freshly-rendered PDF the moment it's ready, once, instead of making the user find and
  // click a link themselves after watching it appear.
  useEffect(() => {
    if (liveStatus?.status === "completed" && liveStatus.pdfUrl && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      const tab = pendingWindowRef.current;
      if (tab && !tab.closed) {
        tab.location.href = liveStatus.pdfUrl;
      } else {
        // The click-time window.open() can itself come back null (popups fully disabled, or this
        // ran outside a real click, e.g. dev tooling) — fall back to a normal link click's worth of
        // effort rather than silently doing nothing.
        window.open(liveStatus.pdfUrl, "_blank", "noopener,noreferrer");
      }
    } else if (liveStatus?.status === "failed" && pendingWindowRef.current && !pendingWindowRef.current.closed) {
      // Don't leave a blank about:blank tab sitting around when the render failed.
      pendingWindowRef.current.close();
    }
  }, [liveStatus]);

  useEffect(() => {
    if (timedOut && pendingWindowRef.current && !pendingWindowRef.current.closed) {
      // Same reasoning as the "failed" branch above — a job stuck past the client's own patience
      // shouldn't leave a dead blank tab behind either, even though the job itself might still be
      // pending server-side (see the doc comment above timedOut's declaration).
      pendingWindowRef.current.close();
    }
  }, [timedOut]);

  return { liveStatus, polling, timedOut, beginGenerate, startPolling };
}
