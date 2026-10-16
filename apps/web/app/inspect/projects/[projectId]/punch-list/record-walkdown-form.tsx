"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { recordWalkdownAction, type RecordWalkdownState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { compressFormPhotos } from "@/lib/media/compress-form-photos";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(recordWalkdownAction, initialState);
  const [rowIds, setRowIds] = useState<number[]>([nextRowId()]);
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  // Idempotency key per attempt: a double tap or refresh-resubmit cannot record the walk-down twice.
  const [requestId, setRequestId] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
    setRequestId(crypto.randomUUID());
  }, [resetKey]);
  async function submit(formData: FormData) {
    const keys = formData.getAll("row_key").map(String);
    const tooBig = await compressFormPhotos(formData, keys.map((k) => `photos_${k}`));
    setPhotoError(tooBig);
    if (tooBig) return;
    formAction(formData);
  }
  const lastAdded = useRef<RecordWalkdownState | null>(null);
  // Start a fresh blank sheet only after a SUCCESSFUL record - on error the rows stay for retry.
  useEffect(() => {
    if (state.addedCount && lastAdded.current !== state) {
      lastAdded.current = state;
      setRowIds([nextRowId()]);
      setResetKey((k) => k + 1);
    }
  }, [state]);

  function addRow() {
    setRowIds((ids) => [...ids, nextRowId()]);
  }

  function removeRow(id: number) {
    setRowIds((ids) => (ids.length > 1 ? ids.filter((rowId) => rowId !== id) : ids));
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Tx>Record walk-down</Tx>
      </Button>
    );
  }

  return (
    <form
      key={resetKey}
      action={submit}
      encType="multipart/form-data"
      className="w-full rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="request_id" value={requestId} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink"><Tx>Record walk-down</Tx></h3>
          <p className="mt-0.5 text-xs text-muted">
            <Tx>One row per item found.</Tx>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-ink"
        >
          <Tx>Cancel</Tx>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-4">
        <label className="text-xs font-medium text-ink">
          <Tx>Walk-down date</Tx>
          <input name="walked_on" type="date" className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
        </label>
        <label className="text-xs font-medium text-ink">
          <Tx>Area walked</Tx>
          <input name="walkdown_area" maxLength={200} className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
        </label>
        <label className="text-xs font-medium text-ink">
          <Tx>Attendees</Tx>
          <input aria-label={tl("Names / organisations")} name="walkdown_attendees" maxLength={500} placeholder={tl("Names / organisations")} className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
        </label>
        <label className="text-xs font-medium text-ink">
          <Tx>Notes</Tx>
          <input name="walkdown_notes" maxLength={2000} className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {rowIds.map((rowId, index) => (
          <div key={rowId} className="grid grid-cols-1 items-end gap-3 rounded-md border border-border bg-surface-subtle p-3 md:grid-cols-2">
            <div className="min-w-0 md:col-span-2">
              <label htmlFor={`walkdown-description-${rowId}`} className="block text-xs font-medium text-ink">
                <Tx>Item found</Tx>
              </label>
              <input
                id={`walkdown-description-${rowId}`}
                name="description"
                placeholder={tl("What was found during the walk-down…")}
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              />
            </div>

            <div className="min-w-0">
              <label htmlFor={`walkdown-location-${rowId}`} className="block text-xs font-medium text-ink">
                <Tx>Location / ITP area</Tx>
              </label>
              <input
                id={`walkdown-location-${rowId}`}
                name="location"
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              />
            </div>

            <div className="min-w-0">
              <label htmlFor={`walkdown-party-${rowId}`} className="block text-xs font-medium text-ink">
                <Tx>Responsible party</Tx>
              </label>
              <select
                id={`walkdown-party-${rowId}`}
                name="responsible_party_id"
                defaultValue=""
                className="mt-1 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              >
                <option value=""><Tx>Unassigned</Tx></option>
                {projectParties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                  </option>
                ))}
              </select>
            </div>

            <input type="hidden" name="row_key" value={rowId} />
            <div className="min-w-0">
              <label htmlFor={`walkdown-priority-${rowId}`} className="block text-xs font-medium text-ink">
                <Tx>Priority</Tx>
              </label>
              <select
                id={`walkdown-priority-${rowId}`}
                name="priority"
                defaultValue="B"
                className="mt-1 min-h-11 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              >
                <option value="A"><Tx>A - critical</Tx></option>
                <option value="B"><Tx>B - major</Tx></option>
                <option value="C"><Tx>C - minor</Tx></option>
              </select>
            </div>

            <div className="min-w-0">
              <label htmlFor={`walkdown-photo-${rowId}`} className="block text-xs font-medium text-ink">
                <Tx>Photo</Tx>
              </label>
              <input
                id={`walkdown-photo-${rowId}`}
                name={`photos_${rowId}`}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                capture="environment"
                multiple
                className="mt-1 w-full text-xs"
              />
            </div>

            <div className="min-w-0">
              <label htmlFor={`walkdown-due-${rowId}`} className="block text-xs font-medium text-ink">
                <Tx>Due date</Tx>
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
                <Tx>Remove</Tx>
              </button>
            )}
          </div>
        ))}
      </div>

      {photoError && <p role="alert" className="mt-2 text-sm text-danger">{photoError}</p>}
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
      {!pending && !state.error && state.addedCount ? (
        <p className="mt-2 text-sm text-success">
          <Tx>Recorded</Tx> {state.addedCount} <Tx>item</Tx>{state.addedCount === 1 ? "" : "s"} <Tx>from the walk-down.</Tx>
        </p>
      ) : null}
      <StickyActionBar inCard className="mt-3 md:mt-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record walk-down"}
        </Button>
        <Button type="button" onClick={addRow} variant="outline">
          <Tx>+ Add another item</Tx>
        </Button>
      </StickyActionBar>
    </form>
  );
}
