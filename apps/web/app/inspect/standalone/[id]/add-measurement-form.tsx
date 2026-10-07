"use client";

import { useActionState, useRef, useState } from "react";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { addMeasurementAction, type AddMeasurementState } from "@/lib/standalone/actions";

const initialState: AddMeasurementState = { error: null };

export function AddMeasurementForm({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(addMeasurementAction, initialState);
  const [queued, setQueued] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Offline: keep the reading on this device and send it when the connection returns.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setQueued(false);
    if (navigator.onLine) return;
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fields: Record<string, string> = { kind: "standalone_measurement" };
    for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) fields[k] = v;
    if (!fields.description?.trim()) return;
    await enqueueOutboxItem({ kind: "standalone_measurement", fields });
    notifyOutboxChanged();
    formRef.current?.reset();
    setQueued(true);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border bg-off-white px-4 py-3">
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
      {queued && <p className="w-full text-sm text-muted">Saved on this device — it will be sent when you&apos;re back online.</p>}
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
