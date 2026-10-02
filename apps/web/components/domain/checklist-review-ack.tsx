"use client";

import { useId } from "react";

/**
 * "I have reviewed the checklist" confirmation shown next to Approve / Accept. The submit button
 * stays disabled until it is ticked, and the ticked value is posted as `checklist_reviewed` so the
 * server action can enforce it as well (lib/itps/checklist-review.ts).
 */
export function ChecklistReviewAck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-ink">
      <input
        id={id}
        type="checkbox"
        name="checklist_reviewed"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>I have reviewed the checklist that goes with this ITP.</span>
    </label>
  );
}
