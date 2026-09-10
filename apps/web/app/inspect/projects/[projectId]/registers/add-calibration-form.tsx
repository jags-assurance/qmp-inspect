"use client";

import { useActionState } from "react";
import { addCalibrationEntryAction, type AddCalibrationEntryState } from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";

const initialState: AddCalibrationEntryState = { error: null };

export function AddCalibrationForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addCalibrationEntryAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="min-w-48 flex-1">
        <label htmlFor="instrument_name" className="block text-xs font-medium text-ink">
          Instrument
        </label>
        <input
          id="instrument_name"
          name="instrument_name"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-40">
        <label htmlFor="cert_number" className="block text-xs font-medium text-ink">
          Cert number
        </label>
        <input
          id="cert_number"
          name="cert_number"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="cal_date" className="block text-xs font-medium text-ink">
          Cal. date
        </label>
        <input
          id="cal_date"
          name="cal_date"
          type="date"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="due_date" className="block text-xs font-medium text-ink">
          Due date
        </label>
        <input
          id="due_date"
          name="due_date"
          type="date"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="cal_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input
          id="cal_notes"
          name="notes"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add instrument"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
