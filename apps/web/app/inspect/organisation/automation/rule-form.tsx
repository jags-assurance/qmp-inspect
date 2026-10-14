"use client";

import { useActionState, useState } from "react";
import { upsertAutomationRuleAction, type UpsertAutomationRuleState } from "@/lib/automation/actions";
import { Button } from "@/components/ui/button";
import { MoreDetails } from "@/components/domain/more-details";
import { Badge } from "@/components/ui/badge";
import type { AutomationRuleType } from "@/lib/automation/types";
import { Tx } from "@/components/domain/tx";

const initialState: UpsertAutomationRuleState = { error: null };

export function RuleForm({
  organizationId,
  ruleType,
  label,
  description,
  enabled,
  thresholdHours,
  repeatHours,
}: {
  organizationId: string;
  ruleType: AutomationRuleType;
  label: string;
  description: string;
  enabled: boolean;
  thresholdHours: number;
  repeatHours: number;
}) {
  const [state, formAction, pending] = useActionState(upsertAutomationRuleAction, initialState);
  const [isEnabled, setIsEnabled] = useState(enabled);

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="rule_type" value={ruleType} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{label}</h3>
            <Badge tone={isEnabled ? "success" : "neutral"}>{isEnabled ? "On" : "Off"}</Badge>
          </div>
          <MoreDetails className="mt-1"><p>{description}</p></MoreDetails>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="enabled" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
          <Tx>Enabled</Tx>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={`${ruleType}-threshold`} className="block text-xs text-muted">
            <Tx>Nudge after (hours)</Tx>
          </label>
          <input
            id={`${ruleType}-threshold`}
            name="threshold_hours"
            type="number"
            min={1}
            defaultValue={thresholdHours}
            className="mt-1 w-28 rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor={`${ruleType}-repeat`} className="block text-xs text-muted">
            <Tx>Don&rsquo;t repeat within (hours)</Tx>
          </label>
          <input
            id={`${ruleType}-repeat`}
            name="repeat_hours"
            type="number"
            min={1}
            defaultValue={repeatHours}
            className="mt-1 w-28 rounded-md border border-border bg-off-white px-2.5 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
