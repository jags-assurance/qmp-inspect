"use client";

import { useActionState, useState } from "react";
import { recordWalkdownAction, type RecordWalkdownState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";

const initialState: RecordWalkdownState = { error: null };

let rowIdCounter = 0;
function nextRowId(): number {
  rowIdCounter += 1;
  return rowIdCounter;
}

/**
 * R95: the "Record walk-down" flow — a JAGS inspector or client logs one or more punch-list items
 * straight from a final walk-down of the project, source tagged 'walkdown' (see
 * lib/punch-list/actions.ts's recordWalkdownAction for why this doesn't invent a separate
 * walk-down-inspection entity). Separate from AddPunchItemForm above: that form is for a single
 * one-off manual entry (source: 'manual'); this one is for the walk-down itself, which routinely
 * surfaces several items in one pass, so it supports adding more than one row before submitting.
 */
export function RecordWalkdownForm({
  projectId,
  projectParties,
}: {
  projectId: string;
  projectParties: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(recordWalkdownAction, initialState);
  const [rowIds, setRowIds] = useState<number[]>([nextRowId()]);
  const [open, setOpen] = useState(false);

  function addRow() {
    setRowIds((ids) => [...ids, nextRowId()]);
  }

  function removeRow(id: number) {
    setRowIds((ids) => (ids.length > 1 ? ids.filter((rowId) => rowId !== id) : ids));
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Record walk-down
      </Button>
    );
  }

  return (
    <form
      action={(formData) => {
        formAction(formData);
        setRowIds([nextRowId()]);
      }}
      className="rounded-lg border border-border bg-off-white p-4"
    >
      <input type="hidden" name="project_id" value={projectId} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink">Record walk-down</h3>
          <p className="mt-0.5 text-xs text-muted">
            Log everything found during this walk-down as punch items — add a row for each item.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {rowIds.map((rowId, index) => (
          <div key={rowId} className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3">
            <div className="min-w-56 flex-1">
              <label htmlFor={`walkdown-description-${rowId}`} className="block text-xs font-medium text-ink">
                Item found
              </label>
              <input
                id={`walkdown-description-${rowId}`}
                name="description"
                placeholder="What was found during the walk-down…"
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              />
            </div>

            <div className="w-40">
              <label htmlFor={`walkdown-location-${rowId}`} className="block text-xs font-medium text-ink">
                Location / ITP area
              </label>
              <input
                id={`walkdown-location-${rowId}`}
                name="location"
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              />
            </div>

            <div className="w-48">
              <label htmlFor={`walkdown-party-${rowId}`} className="block text-xs font-medium text-ink">
                Responsible party
              </label>
              <select
                id={`walkdown-party-${rowId}`}
                name="responsible_party_id"
                defaultValue=""
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              >
                <option value="">Unassigned</option>
                {projectParties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-36">
              <label htmlFor={`walkdown-due-${rowId}`} className="block text-xs font-medium text-ink">
                Due date
              </label>
              <input
                id={`walkdown-due-${rowId}`}
                name="due_date"
                type="date"
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              />
            </div>

            {rowIds.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(rowId)}
                className="text-xs text-muted hover:text-danger"
                aria-label={`Remove item ${index + 1}`}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={addRow} className="text-sm text-burgundy hover:underline">
          + Add another item
        </button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Recording…" : "Record walk-down"}
        </Button>
      </div>

      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
      {!pending && !state.error && state.addedCount ? (
        <p className="mt-2 text-sm text-success">
          Recorded {state.addedCount} item{state.addedCount === 1 ? "" : "s"} from the walk-down.
        </p>
      ) : null}
    </form>
  );
}
