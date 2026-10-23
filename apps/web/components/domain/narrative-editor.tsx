"use client";

import { useActionState, useState } from "react";
import { cleanUpNarrativeAction, type CleanUpNarrativeState, type DraftReportNarrativeState, type SaveNarrativeState } from "@/lib/reports/actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const draftInitialState: DraftReportNarrativeState = { error: null, narrative: null, aiLogId: null };
const saveInitialState: SaveNarrativeState = { error: null };
const cleanupInitialState: CleanUpNarrativeState = { error: null, cleaned: null, aiLogId: null };

/**
 * Shared "Draft with AI, review, save" editor for a report's conclusion paragraph (R111) — used
 * by both the Inspection Report and the FAT Report, since both need the exact same pattern:
 * generate a draft from the record's own real facts, let a person edit it freely, then persist
 * only once they explicitly save. Nothing is ever auto-saved from the draft step.
 */
export function NarrativeEditor({
  recordIdFieldName,
  recordId,
  /** Only needed for the "Clean up wording" assist (R111), to resolve the org for the AI gate —
   *  omit it (or omit `aiConfigured`) to render the editor exactly as before with no clean-up
   *  button, e.g. on a deployment with no AI key configured (R43's pattern). */
  projectId,
  aiConfigured,
  initialNarrative,
  draftAction,
  saveAction,
}: {
  /** Hidden field name the draft/save actions expect — "inspection_record_id" or "assignment_id". */
  recordIdFieldName: string;
  recordId: string;
  projectId?: string;
  aiConfigured?: boolean;
  initialNarrative: string | null;
  draftAction: (state: DraftReportNarrativeState, formData: FormData) => Promise<DraftReportNarrativeState>;
  saveAction: (state: SaveNarrativeState, formData: FormData) => Promise<SaveNarrativeState>;
}) {
  const tl = useTranslate();
  const [draftState, draftFormAction, draftPending] = useActionState(draftAction, draftInitialState);
  const [saveState, saveFormAction, savePending] = useActionState(saveAction, saveInitialState);
  const keepValuesSubmit_saveFormAction = useKeepFormValues(saveState, saveFormAction);
  const [cleanupState, cleanupFormAction, cleanupPending] = useActionState(cleanUpNarrativeAction, cleanupInitialState);
  const [narrative, setNarrative] = useState(initialNarrative ?? "");
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [aiOriginalNarrative, setAiOriginalNarrative] = useState<string | null>(null);

  const [appliedDraftState, setAppliedDraftState] = useState(draftState);
  if (draftState !== appliedDraftState) {
    setAppliedDraftState(draftState);
    if (draftState.narrative !== null) {
      setNarrative(draftState.narrative);
      setAiLogId(draftState.aiLogId);
      setAiOriginalNarrative(draftState.narrative);
    }
  }

  // Clean-up is explicitly NOT auto-applied: it only surfaces a suggestion box with its own
  // Accept/Discard buttons below (same review-required principle as every other AI assist here) —
  // it never touches `narrative` on its own the way the draft action above replaces it directly.
  const [appliedCleanupState, setAppliedCleanupState] = useState(cleanupState);
  if (cleanupState !== appliedCleanupState) {
    setAppliedCleanupState(cleanupState);
  }
  const [cleanupDiscarded, setCleanupDiscarded] = useState(false);
  const showCleanupSuggestion = cleanupState.cleaned !== null && !cleanupDiscarded && cleanupState.cleaned !== narrative;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink"><Tx>Report conclusion / narrative</Tx></h2>
        <form action={draftFormAction}>
          <input type="hidden" name={recordIdFieldName} value={recordId} />
          <Button
            type="submit"
            disabled={draftPending}
            variant="outline" size="sm"
          >
            {draftPending ? "Drafting…" : "Draft with AI"}
          </Button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted">
        <Tx>Used as the PDF&apos;s conclusion paragraph once saved. Leave blank to use the automatic factual summary instead.</Tx>
      </p>

      {draftState.error && <p role="alert" className="mt-2 text-xs text-danger">{draftState.error}</p>}

      <form onSubmit={keepValuesSubmit_saveFormAction} className="mt-3 space-y-2">
        <input type="hidden" name={recordIdFieldName} value={recordId} />
        <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />
        <input type="hidden" name="ai_original_narrative" value={aiOriginalNarrative ?? ""} />
        <textarea
          name="narrative"
          value={narrative}
          onChange={(e) => {
            setNarrative(e.target.value);
            setCleanupDiscarded(false);
          }}
          rows={4}
          placeholder={tl("e.g. The inspection of... was completed in accordance with... The recorded result is...")}
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={savePending}
            size="sm"
          >
            {savePending ? "Saving…" : "Save narrative"}
          </Button>
          {aiConfigured && projectId && (
            <Button
              type="button"
              disabled={cleanupPending || !narrative.trim()}
              onClick={() => {
                const fd = new FormData();
                fd.set("project_id", projectId);
                fd.set("text", narrative);
                setCleanupDiscarded(false);
                cleanupFormAction(fd);
              }}
              variant="outline" size="sm"
            >
              {cleanupPending ? "Cleaning up…" : "Clean up wording"}
            </Button>
          )}
          {saveState.error && <p role="alert" className="text-xs text-danger">{saveState.error}</p>}
        </div>
      </form>

      {cleanupState.error && <p role="alert" className="mt-2 text-xs text-danger">{cleanupState.error}</p>}

      {showCleanupSuggestion && (
        <div className="mt-3 rounded-md border border-border bg-off-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted"><Tx>AI-cleaned-up suggestion</Tx></p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{cleanupState.cleaned}</p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              onClick={() => {
                setNarrative(cleanupState.cleaned ?? "");
                setCleanupDiscarded(true);
              }}
              size="sm"
            >
              <Tx>Accept</Tx>
            </Button>
            <Button
              type="button"
              onClick={() => setCleanupDiscarded(true)}
              variant="outline" size="sm"
            >
              <Tx>Discard</Tx>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
