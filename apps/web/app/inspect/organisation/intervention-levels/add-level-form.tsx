"use client";

import { useActionState } from "react";
import { addInterventionLevelAction, type InterventionLevelState } from "@/lib/intervention-levels/actions";
import { Button } from "@/components/ui/button";

const initialState: InterventionLevelState = { error: null };

/** Adds a genuinely new, org-specific level (e.g. "Client QA Review") — the actual ask behind this
 *  feature, not just editing the four built-ins. Sort order is left blank (the action appends it to
 *  the end of this org's list); an admin can fine-tune order afterward via each row's own "Order"
 *  field on the settings page above. */
export function AddLevelForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(addInterventionLevelAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-[90px_1fr_90px_110px_auto]">
      <input type="hidden" name="organization_id" value={organizationId} />
      <div>
        <label className="block text-xs text-muted">Code</label>
        <input
          name="code"
          required
          maxLength={8}
          placeholder="e.g. CQR"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm uppercase outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs text-muted">Label</label>
        <input
          name="label"
          required
          placeholder="e.g. Client QA Review"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <label className="flex items-center gap-1.5 pb-2 text-xs text-muted">
        <input type="checkbox" name="is_blocking" />
        Blocking
      </label>
      <div>
        <label className="block text-xs text-muted">Notice hrs</label>
        <input
          name="default_notice_hours"
          type="number"
          min={0}
          placeholder="none"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add level"}
      </Button>
      {state.error && <p className="col-span-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
