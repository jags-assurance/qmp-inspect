"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { deleteItpItemAction, editItpItemAction, type EditItemState } from "@/lib/itps/actions";

const initialState: EditItemState = { error: null };

/**
 * Edit + Delete for a single ITP item row in the sign-off grid — previously the grid only supported
 * Add (see AddItemForm), with no way to fix or remove an activity short of the staff-only offline
 * .xlsx re-upload. Shown in place of the plain item-number/activity text once canEditContent is
 * true, mirroring SectionControls' inline-toggle + prompt()-for-revision-reason pattern.
 */
export function ItemControls({
  itpId,
  itemId,
  itemNumber,
  activity,
  acceptanceCriteria,
  evidenceType,
  disciplineId,
  noticeHoursOverride,
  disciplines,
  isIssued,
}: {
  itpId: string;
  itemId: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  evidenceType: number;
  disciplineId: string | null;
  noticeHoursOverride: number | null;
  disciplines: { id: string; code: string; name: string }[];
  isIssued: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(editItpItemAction, initialState);
  const editReasonRef = useRef<HTMLInputElement>(null);
  const deleteReasonRef = useRef<HTMLInputElement>(null);
  const hasSubmittedRef = useRef(false);

  // Close the edit form once a save actually succeeds (state flips to no-error after a real
  // submission) — a plain `state.error === null` check alone would also fire on first mount, since
  // that's initialState's own shape.
  useEffect(() => {
    if (hasSubmittedRef.current && !pending && state.error === null) {
      hasSubmittedRef.current = false;
      setIsEditing(false);
    }
  }, [state, pending]);

  function askRevisionReason(): string | null {
    const reason = prompt("This ITP has already been issued — reason for this change (will start a new revision):");
    return reason && reason.trim() ? reason.trim() : null;
  }

  function handleEditSubmit(e: FormEvent<HTMLFormElement>) {
    if (isIssued) {
      const reason = askRevisionReason();
      if (!reason) {
        e.preventDefault();
        return;
      }
      editReasonRef.current!.value = reason;
    }
    hasSubmittedRef.current = true;
  }

  function handleDeleteSubmit(e: FormEvent<HTMLFormElement>) {
    if (!confirm(`Delete activity "${itemNumber}: ${activity}"? This also deletes its interventions and sign-off history. This cannot be undone.`)) {
      e.preventDefault();
      return;
    }
    if (isIssued) {
      const reason = askRevisionReason();
      if (!reason) {
        e.preventDefault();
        return;
      }
      deleteReasonRef.current!.value = reason;
    }
  }

  if (!isEditing) {
    return (
      <div>
        <p className="text-sm text-ink">
          <span className="doc-id mr-1.5 text-muted">{itemNumber}</span>
          {activity}
        </p>
        {acceptanceCriteria && <p className="mt-0.5 text-xs text-muted">{acceptanceCriteria}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium hover:bg-off-white"
          >
            Edit
          </button>
          <form action={deleteItpItemAction} onSubmit={handleDeleteSubmit}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="item_id" value={itemId} />
            <input type="hidden" name="revision_reason" ref={deleteReasonRef} />
            <button type="submit" className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/10">
              Delete
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={handleEditSubmit} className="flex flex-col gap-1.5">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="revision_reason" ref={editReasonRef} />
      <div className="flex gap-1.5">
        <input
          name="item_number"
          defaultValue={itemNumber}
          required
          className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
        <input
          name="activity"
          defaultValue={activity}
          required
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
      </div>
      <input
        name="acceptance_criteria"
        defaultValue={acceptanceCriteria ?? ""}
        placeholder="Acceptance criteria"
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
      />
      <div className="flex flex-wrap gap-1.5">
        <select
          name="evidence_type"
          defaultValue={String(evidenceType)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        >
          <option value="1">Checklist</option>
          <option value="2">Document upload</option>
          <option value="3">Measurement</option>
        </select>
        <select
          name="discipline_id"
          defaultValue={disciplineId ?? ""}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        >
          <option value="">— Discipline —</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
        <input
          name="notice_hours_override"
          type="number"
          min={0}
          defaultValue={noticeHoursOverride ?? ""}
          placeholder="Notice hrs"
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-border bg-off-white px-2 py-1 text-[10px] font-medium hover:bg-surface disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="rounded border border-border px-2 py-1 text-[10px] font-medium hover:bg-off-white"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
