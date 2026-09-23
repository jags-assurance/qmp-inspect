"use client";

import { useEffect, useState } from "react";

/**
 * Was a full-width banner shown persistently for as long as the ITP stayed newer than its last
 * rendered PDF (see page.tsx's own isPdfStale — content or a sign-off changed since the PDF was
 * generated). Regenerating is a plain template/render job, not an AI call, so there's no cost
 * reason to hold back on surfacing it — the actual problem reported was that a banner sitting there
 * indefinitely reads as "always on" and gets tuned out, not that it fired too eagerly.
 *
 * Replaced with a one-time dismissible toast: fires once per distinct staleness event (tracked in
 * sessionStorage keyed by `changedAt`, which only changes when the ITP's own updated_at actually
 * moves again — see page.tsx), auto-dismisses after a few seconds, and never re-shows itself on a
 * later visit for the same still-stale state a viewer already saw and dismissed (or that just
 * auto-dismissed on them).
 */
export function ItpStalePdfToast({ isStale, changedAt }: { isStale: boolean; changedAt: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStale) return;
    const storageKey = `jags-itp-pdf-stale-seen:${changedAt}`;
    let alreadySeen = false;
    try {
      alreadySeen = !!sessionStorage.getItem(storageKey);
      if (!alreadySeen) sessionStorage.setItem(storageKey, "1");
    } catch {
      // Private browsing / storage blocked — just show it every visit, harmless either way.
    }
    if (alreadySeen) return;
    // Deferred to a macrotask rather than calling setVisible synchronously in the effect body —
    // avoids the cascading-render pattern React's own lint rule flags, with no behavioral
    // difference (still shows on this same render pass, just not synchronously inside the effect).
    const showTimer = setTimeout(() => setVisible(true), 0);
    const hideTimer = setTimeout(() => setVisible(false), 8000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isStale, changedAt]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-40 max-w-sm rounded-md border border-warning/60 bg-warning/10 px-4 py-3 text-sm font-medium text-warning shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span className="flex-1">This ITP has changed since its PDF was last generated — use &ldquo;⋯ More → Regenerate PDF&rdquo; to pick up the latest state.</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="shrink-0 text-warning/70 hover:text-warning"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
