"use client";

import { useActionState } from "react";
import { updateOrgPlanAction, type PlanSettingsState } from "@/lib/plans/actions";
import { Button } from "@/components/ui/button";

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
  const [state, formAction, pending] = useActionState(updateOrgPlanAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div>
        <label htmlFor="plan_tier" className="block text-xs text-muted">
          Plan tier
        </label>
        <select
          id="plan_tier"
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
      </div>

      <div>
        <label htmlFor="seat_limit" className="block text-xs text-muted">
          Seat limit
        </label>
        <input
          id="seat_limit"
          name="seat_limit"
          type="number"
          min={0}
          step={1}
          defaultValue={seatLimit ?? ""}
          placeholder="Unlimited"
          className="mt-1 w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save plan"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
