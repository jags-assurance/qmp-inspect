"use client";

import { useActionState, useState } from "react";
import { updateNcrAction, suggestNcrRootCauseAction, type UpdateNcrState, type SuggestRootCauseState } from "@/lib/ncrs/actions";
import { Button } from "@/components/ui/button";

const initialState: UpdateNcrState = { error: null };
const suggestInitialState: SuggestRootCauseState = { error: null, rootCause: null };

export function CloseOutForm({
  ncrId,
  assignedTo,
  people,
  dueDate,
  rootCause,
  correctiveAction,
  preventiveAction,
  verificationNotes,
  isClosed,
}: {
  ncrId: string;
  assignedTo: string | null;
  people: { id: string; name: string }[];
  dueDate: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  verificationNotes: string | null;
  isClosed: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateNcrAction, initialState);
  const [suggestState, suggestFormAction, suggestPending] = useActionState(suggestNcrRootCauseAction, suggestInitialState);
  const [fields, setFields] = useState({
    rootCause: rootCause ?? "",
    correctiveAction: correctiveAction ?? "",
    verificationNotes: verificationNotes ?? "",
  });

  const [appliedSuggestState, setAppliedSuggestState] = useState(suggestState);
  if (suggestState !== appliedSuggestState) {
    setAppliedSuggestState(suggestState);
    if (suggestState.rootCause !== null) setFields((f) => ({ ...f, rootCause: suggestState.rootCause! }));
  }

  const canClose = Boolean(fields.rootCause.trim() && fields.correctiveAction.trim() && fields.verificationNotes.trim());

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ncr_id" value={ncrId} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="assigned_to" className="block text-sm font-medium text-ink">
            Assigned to
          </label>
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={assignedTo ?? ""}
            disabled={isClosed}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          >
            <option value="">Unassigned</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="due_date" className="block text-sm font-medium text-ink">
            Due date
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            required
            defaultValue={dueDate ?? ""}
            disabled={isClosed}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="root_cause" className="block text-sm font-medium text-ink">
            Root cause
          </label>
          {!isClosed && (
            <button
              type="button"
              onClick={() => {
                const fd = new FormData();
                fd.set("ncr_id", ncrId);
                suggestFormAction(fd);
              }}
              disabled={suggestPending}
              className="text-xs font-medium text-burgundy hover:underline disabled:opacity-50"
            >
              {suggestPending ? "Suggesting…" : "Suggest with AI"}
            </button>
          )}
        </div>
        <textarea
          id="root_cause"
          name="root_cause"
          rows={3}
          value={fields.rootCause}
          disabled={isClosed}
          onChange={(e) => setFields((f) => ({ ...f, rootCause: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        {suggestState.error && <p className="mt-1 text-xs text-danger">{suggestState.error}</p>}
      </div>

      <div>
        <label htmlFor="corrective_action" className="block text-sm font-medium text-ink">
          Corrective action
        </label>
        <textarea
          id="corrective_action"
          name="corrective_action"
          rows={3}
          defaultValue={correctiveAction ?? ""}
          disabled={isClosed}
          onChange={(e) => setFields((f) => ({ ...f, correctiveAction: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="preventive_action" className="block text-sm font-medium text-ink">
          Preventive action
        </label>
        <textarea
          id="preventive_action"
          name="preventive_action"
          rows={3}
          defaultValue={preventiveAction ?? ""}
          disabled={isClosed}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="verification_notes" className="block text-sm font-medium text-ink">
          Verification of effectiveness
        </label>
        <textarea
          id="verification_notes"
          name="verification_notes"
          rows={3}
          defaultValue={verificationNotes ?? ""}
          disabled={isClosed}
          onChange={(e) => setFields((f) => ({ ...f, verificationNotes: e.target.value }))}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      {!isClosed && (
        <div className="flex gap-3">
          <Button type="submit" name="close_now" value="false" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save progress"}
          </Button>
          <Button type="submit" name="close_now" value="true" disabled={pending || !canClose}>
            {pending ? "Closing…" : "Close NCR"}
          </Button>
        </div>
      )}
      {!canClose && !isClosed && (
        <p className="text-xs text-muted">
          Root cause, corrective action and verification notes are all required before this NCR can be closed.
        </p>
      )}
    </form>
  );
}
