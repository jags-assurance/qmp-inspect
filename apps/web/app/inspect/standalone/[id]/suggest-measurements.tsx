"use client";

import { useActionState } from "react";
import {
  addMeasurementAction,
  suggestStandaloneMeasurementsAction,
  type AddMeasurementState,
  type SuggestMeasurementsState,
} from "@/lib/standalone/actions";
import { Tx } from "@/components/domain/tx";
import { MoreDetails } from "@/components/domain/more-details";
import { Button } from "@/components/ui/button";

const suggestInitialState: SuggestMeasurementsState = { error: null, suggestions: null };

/**
 * "Suggest with AI" for the measurements tab — drafts equipment-specific measurement/test
 * parameters, then lets the inspector add each one individually (its own addMeasurementAction
 * submit), reviewing/editing nothing here itself but never bulk-inserting without a per-row
 * confirmation. Mirrors NarrativeEditor's "draft with AI, human decides" shape.
 */
export function SuggestMeasurements({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(suggestStandaloneMeasurementsAction, suggestInitialState);

  return (
    <div className="border-t border-border bg-surface px-4 py-3">
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <Button
          type="submit"
          disabled={pending}
          variant="outline" size="sm"
        >
          {pending ? "Thinking…" : "Suggest with AI"}
        </Button>
        <MoreDetails label="What is this?" className="">
          <p><Tx>Drafts test parameters for this equipment. Review each before adding.</Tx></p>
        </MoreDetails>
      </form>

      {state.error && <p role="alert" className="mt-2 text-xs text-danger">{state.error}</p>}

      {state.suggestions && state.suggestions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {state.suggestions.map((s, i) => (
            <SuggestionRow key={`${s.description}-${i}`} assignmentId={assignmentId} suggestion={s} />
          ))}
        </ul>
      )}

      {state.suggestions && state.suggestions.length === 0 && (
        <p className="mt-2 text-xs text-muted"><Tx>No suggestions came back — try adding a standard reference to the assignment.</Tx></p>
      )}
    </div>
  );
}

const addInitialState: AddMeasurementState = { error: null };

function SuggestionRow({
  assignmentId,
  suggestion,
}: {
  assignmentId: string;
  suggestion: { description: string; nominal: string; tolerance: string; unit: string };
}) {
  const [state, formAction, pending] = useActionState(addMeasurementAction, addInitialState);
  const added = !pending && state.error === null && state !== addInitialState;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-off-white px-3 py-2 text-xs">
      <div className="min-w-40 flex-1">
        <p className="text-sm text-ink">{suggestion.description}</p>
        <p className="mt-0.5 text-muted">
          {suggestion.nominal ? `Nominal: ${suggestion.nominal}` : "No nominal value"}
          {suggestion.tolerance ? ` · Tolerance: ${suggestion.tolerance}` : ""}
          {suggestion.unit ? ` · Unit: ${suggestion.unit}` : ""}
        </p>
      </div>
      <form action={formAction}>
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <input type="hidden" name="description" value={suggestion.description} />
        <input type="hidden" name="nominal_value" value={suggestion.nominal} />
        <input type="hidden" name="tolerance" value={suggestion.tolerance} />
        <input type="hidden" name="unit" value={suggestion.unit} />
        <Button
          type="submit"
          disabled={pending || added}
          variant="outline" size="sm"
        >
          {added ? "Added" : pending ? "Adding…" : "+ Add"}
        </Button>
      </form>
      {state.error && <p role="alert" className="w-full text-danger">{state.error}</p>}
    </li>
  );
}
