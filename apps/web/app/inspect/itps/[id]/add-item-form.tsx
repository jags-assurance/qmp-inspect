"use client";

import { useActionState } from "react";
import { addItpItemAction, type AddItemState } from "@/lib/itps/actions";

const initialState: AddItemState = { error: null };

export function AddItemForm({
  itpId,
  sectionId,
  disciplines,
}: {
  itpId: string;
  sectionId: string;
  disciplines: { id: string; code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(addItpItemAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-border bg-off-white px-4 py-4">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="section_id" value={sectionId} />

      <div>
        <label className="block text-xs font-medium text-muted">Item no.</label>
        <input
          name="item_number"
          required
          placeholder="1.1"
          className="mt-1 w-20 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-48 flex-1">
        <label className="block text-xs font-medium text-muted">Activity</label>
        <input
          name="activity"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-48 flex-1">
        <label className="block text-xs font-medium text-muted">Acceptance criteria</label>
        <input
          name="acceptance_criteria"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Evidence</label>
        <select
          name="evidence_type"
          defaultValue="1"
          className="mt-1 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="1">Checklist</option>
          <option value="2">Document upload</option>
          <option value="3">Measurement</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Discipline</label>
        <select
          name="discipline_id"
          defaultValue=""
          className="mt-1 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">—</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add activity"}
      </button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
