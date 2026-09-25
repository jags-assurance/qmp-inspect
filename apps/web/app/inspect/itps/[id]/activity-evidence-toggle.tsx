"use client";

import { useState } from "react";

/**
 * Expected records / Evidence documents / Measurements used to render fully open under every
 * single activity, always — real clutter on an ITP with many activities (the user's own report:
 * "the distraction of the ui of itp"). Collapsed behind a small named button per activity instead,
 * same "+ Link/Record ..." click-to-reveal pattern this app already uses elsewhere (LinkDocumentForm,
 * AddMeasurementForm) — just applied one level up, to the whole section rather than just its own
 * add-form. Nothing about the data or the child component's own behavior changes; this only defers
 * rendering it until asked for.
 */
export function ActivityEvidenceToggle({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted hover:border-burgundy/40 hover:text-burgundy"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-1.5 w-full rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted hover:text-ink">
          Close
        </button>
      </div>
      {children}
    </div>
  );
}
