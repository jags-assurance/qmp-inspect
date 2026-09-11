"use client";

import { useActionState, useState } from "react";
import type { DraftReportNarrativeState, SaveNarrativeState } from "@/lib/reports/actions";

const draftInitialState: DraftReportNarrativeState = { error: null, narrative: null };
const saveInitialState: SaveNarrativeState = { error: null };

/**
 * Shared "Draft with AI, review, save" editor for a report's conclusion paragraph (R111) — used
 * by both the Inspection Report and the FAT Report, since both need the exact same pattern:
 * generate a draft from the record's own real facts, let a person edit it freely, then persist
 * only once they explicitly save. Nothing is ever auto-saved from the draft step.
 */
export function NarrativeEditor({
  recordIdFieldName,
  recordId,
  initialNarrative,
  draftAction,
  saveAction,
}: {
  /** Hidden field name the draft/save actions expect — "inspection_record_id" or "assignment_id". */
  recordIdFieldName: string;
  recordId: string;
  initialNarrative: string | null;
  draftAction: (state: DraftReportNarrativeState, formData: FormData) => Promise<DraftReportNarrativeState>;
  saveAction: (state: SaveNarrativeState, formData: FormData) => Promise<SaveNarrativeState>;
}) {
  const [draftState, draftFormAction, draftPending] = useActionState(draftAction, draftInitialState);
  const [saveState, saveFormAction, savePending] = useActionState(saveAction, saveInitialState);
  const [narrative, setNarrative] = useState(initialNarrative ?? "");

  const [appliedDraftState, setAppliedDraftState] = useState(draftState);
  if (draftState !== appliedDraftState) {
    setAppliedDraftState(draftState);
    if (draftState.narrative !== null) setNarrative(draftState.narrative);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Report conclusion / narrative</h2>
        <form action={draftFormAction}>
          <input type="hidden" name={recordIdFieldName} value={recordId} />
          <button
            type="submit"
            disabled={draftPending}
            className="rounded-md border border-border bg-off-white px-3 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50"
          >
            {draftPending ? "Drafting…" : "Draft with AI"}
          </button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted">
        Used as the PDF&apos;s conclusion paragraph once saved. Leave blank to use the automatic factual summary instead.
      </p>

      {draftState.error && <p className="mt-2 text-xs text-danger">{draftState.error}</p>}

      <form action={saveFormAction} className="mt-3 space-y-2">
        <input type="hidden" name={recordIdFieldName} value={recordId} />
        <textarea
          name="narrative"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          rows={4}
          placeholder="e.g. The inspection of... was completed in accordance with... The recorded result is..."
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savePending}
            className="rounded-md bg-burgundy px-3 py-1.5 text-xs font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
          >
            {savePending ? "Saving…" : "Save narrative"}
          </button>
          {saveState.error && <p className="text-xs text-danger">{saveState.error}</p>}
        </div>
      </form>
    </div>
  );
}
