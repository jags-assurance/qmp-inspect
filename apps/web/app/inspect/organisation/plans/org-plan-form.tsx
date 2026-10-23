"use client";

import { useActionState } from "react";
import { updateOrgPlanAction, type PlanSettingsState } from "@/lib/plans/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: PlanSettingsState = { error: null };

const TIERS: { value: string; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "enterprise", label: "Enterprise" },
];

export function OrgPlanForm({
  organizationId,
  planTier,
  seatLimit,
}: {
  organizationId: string;
  planTier: string;
  seatLimit: number | null;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(updateOrgPlanAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div>
        <FormField label="Plan tier">
          <select
          name="plan_tier"
          defaultValue={planTier}
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          {TIERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        </FormField>
      </div>

      <div>
        <FormField label="Seat limit">
          <input
          name="seat_limit"
          type="number"
          min={0}
          step={1}
          defaultValue={seatLimit ?? ""}
          placeholder={tl("Unlimited")}
          className="mt-1 w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save plan"}
      </Button>

      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
