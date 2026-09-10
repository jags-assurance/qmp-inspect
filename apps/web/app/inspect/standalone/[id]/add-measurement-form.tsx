"use client";

import { useActionState } from "react";
import { addMeasurementAction, type AddMeasurementState } from "@/lib/standalone/actions";

const initialState: AddMeasurementState = { error: null };

export function AddMeasurementForm({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(addMeasurementAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border bg-off-white px-4 py-3">
      <input type="hidden" name="assignment_id" value={assignmentId} />

      <div className="min-w-48 flex-1">
        <label className="block text-xs text-muted">Description</label>
        <input
          name="description"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs text-muted">Nominal</label>
        <input
          name="nominal_value"
          className="mt-1 w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs text-muted">Tolerance</label>
        <input
          name="tolerance"
          className="mt-1 w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs text-muted">Actual</label>
        <input
          name="actual_value"
          className="mt-1 w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs text-muted">Unit</label>
        <input
          name="unit"
          className="mt-1 w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs text-muted">Result</label>
        <select
          name="result"
          defaultValue=""
          className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="">—</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add measurement"}
      </button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
