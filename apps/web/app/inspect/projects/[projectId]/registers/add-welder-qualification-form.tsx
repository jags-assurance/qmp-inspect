"use client";

import { useActionState } from "react";
import { addWelderQualificationEntryAction, type AddWelderQualificationEntryState } from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";

const initialState: AddWelderQualificationEntryState = { error: null };

export function AddWelderQualificationForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addWelderQualificationEntryAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="w-40">
        <label htmlFor="welder_identifier" className="block text-xs font-medium text-ink">
          Welder ID
        </label>
        <input
          id="welder_identifier"
          name="welder_identifier"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="qualified_wps" className="block text-xs font-medium text-ink">
          Qualified WPS
        </label>
        <input
          id="qualified_wps"
          name="qualified_wps"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="qualified_ranges" className="block text-xs font-medium text-ink">
          Ranges
        </label>
        <input
          id="qualified_ranges"
          name="qualified_ranges"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="expiry_date" className="block text-xs font-medium text-ink">
          Expiry date
        </label>
        <input
          id="expiry_date"
          name="expiry_date"
          type="date"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="welder_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input
          id="welder_notes"
          name="notes"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add welder"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
