"use client";

import { useActionState } from "react";
import { addInterventionLevelAction, type InterventionLevelState } from "@/lib/intervention-levels/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: InterventionLevelState = { error: null };

/** Adds a genuinely new, org-specific level (e.g. "Client QA Review") — the actual ask behind this
 *  feature, not just editing the four built-ins. Sort order is left blank (the action appends it to
 *  the end of this org's list); an admin can fine-tune order afterward via each row's own "Order"
 *  field on the settings page above. */
export function AddLevelForm({ organizationId }: { organizationId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addInterventionLevelAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3 lg:grid-cols-[90px_1fr_90px_110px_auto]">
      <input type="hidden" name="organization_id" value={organizationId} />
      <div>
        <FormField required label="Code">
          <input
          name="code"
          required
          maxLength={8}
          placeholder={tl("e.g. CQR")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm uppercase outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <div>
        <FormField required label="Label">
          <input
          name="label"
          required
          placeholder={tl("e.g. Client QA Review")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="is_blocking" />
        <Tx>Blocking</Tx>
      </label>
      <div>
        <FormField label="Notice hrs">
          <input
          name="default_notice_hours"
          type="number"
          min={0}
          placeholder={tl("none")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add level"}
      </Button>
      {state.error && <p role="alert" className="col-span-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
