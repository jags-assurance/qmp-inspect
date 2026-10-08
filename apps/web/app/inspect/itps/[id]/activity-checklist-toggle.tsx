"use client";

import { useState } from "react";

export interface ActivityChecklist {
  /** The generated checklist's number, or null while it is only the draft that generation starts from. */
  number: string | null;
  lines: { text: string; mandatory: boolean }[];
}

/**
 * The "Checklist" pill on an activity row, made clickable: opens that activity's checklist right
 * under the activity, in the same window — no hop to the Checklists page. Shows the real generated
 * checklist once the ITP is approved, and what generation will start from before that.
 */
export function ActivityChecklistToggle({ label, checklist }: { label: string; checklist: ActivityChecklist | null }) {
  const [open, setOpen] = useState(false);
  if (!checklist) {
    return <span className="inline-flex items-center rounded-full bg-off-white px-2.5 py-0.5 text-xs font-medium text-muted">{label}</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Hide this activity's checklist" : "Show this activity's checklist"}
        className="inline-flex items-center gap-1 rounded-full border border-burgundy/30 bg-off-white px-2.5 py-0.5 text-xs font-medium text-burgundy hover:bg-burgundy/5"
      >
        {label}
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="basis-full rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-xs font-semibold text-ink">
            {checklist.number ? `Checklist ${checklist.number}` : "Checklist — draft (generated when the ITP is approved)"}
            <span className="ms-1.5 font-normal text-muted">
              {checklist.lines.length} item{checklist.lines.length === 1 ? "" : "s"}
            </span>
          </p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {checklist.lines.map((line, i) => (
              <li key={i} className="flex gap-2 text-ink">
                <span aria-hidden="true" className="text-muted">
                  ☐
                </span>
                <span className="[overflow-wrap:anywhere]">
                  {line.text}
                  {line.mandatory && (
                    <span className="ms-1 text-danger" title="Mandatory">
                      *
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
