"use client";

import { useActionState } from "react";
import { addItpSectionAction, type AddSectionState } from "@/lib/itps/sections";
import { FormField } from "@/components/ui/form-field";

const initialState: AddSectionState = { error: null };

/**
 * R24: sections are not fixed to the 4 defaults createItpAction seeds — this lets a section be
 * appended at any point in the ITP's life. Mirrors AddItemForm's shape, including the
 * conditional "Reason for revision" field when the ITP has already been issued (R101).
 */
export function AddSectionForm({ itpId, isIssued }: { itpId: string; isIssued: boolean }) {
  const [state, formAction, pending] = useActionState(addItpSectionAction, initialState);

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="itp_id" value={itpId} />
      <div className="w-full sm:min-w-56 flex-1">
        <FormField label="New section title">
          <input
          name="title"
          required
          placeholder="e.g. Pre-Commissioning Checks"
          className="mt-1 w-full rounded-md border border-border bg-off-white px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      {isIssued && (
        <div className="w-full sm:min-w-64 flex-1">
          <label className="block text-xs font-medium text-danger">Reason for revision (required — this ITP is already issued)</label>
          <input
            name="revision_reason"
            required
            placeholder="Why this section is being added after issue"
            className="mt-1 w-full rounded-md border border-danger/40 bg-off-white px-2.5 py-2 text-sm outline-none focus:border-danger"
          />
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-off-white px-3.5 py-2 text-sm font-medium hover:bg-surface disabled:opacity-50"
      >
        {pending ? "Adding…" : isIssued ? "+ Add section (new revision)" : "+ Add section"}
      </button>
      {isIssued && (
        <p className="w-full text-xs text-warning">
          This ITP has already been issued — adding a section will record a new revision and freeze the current content into history.
        </p>
      )}
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
