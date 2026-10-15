"use client";

import { useActionState, useState } from "react";
import { updateEngagementScopeAction, type NumberingSettingsState } from "@/lib/numbering/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { describeScopeChange, isEngagementScope, summarizeScopeChange } from "@/lib/numbering/scope-impact";
import { Tx } from "@/components/domain/tx";
import { MoreDetails } from "@/components/domain/more-details";

const initialState: NumberingSettingsState = { error: null };

const SCOPES: { value: string; label: string; short: string; description: string }[] = [
  {
    value: "full_service",
    label: "Full-Managed / End-to-End Execution",
    short: "JAGS runs the project.",
    description:
      "JAGS runs the project. Individual projects can still be opted into client execution/ITP-creation via that project's own settings.",
  },
  {
    value: "self_managed",
    label: "Self-Managed (Hybrid)",
    short: "Client creates ITPs; JAGS approves.",
    description:
      "This client's own teams create, submit and accept their own ITPs across every one of their projects — but a JAGS staff member still has to Approve each one. JAGS only provides the platform and standard monitoring otherwise. Applies org-wide, no per-project setup needed.",
  },
  {
    value: "client_managed",
    label: "Full Client-Managed",
    short: "Client creates and approves its own ITPs.",
    description:
      "Everything Self-Managed gives, plus: the client's own people can Approve their own ITPs and create brand-new logins for their own team — both still permission-gated via that client's own Custom roles page, not automatic for every user. JAGS only does the one-time onboarding; no JAGS staff involvement day-to-day after that.",
  },
];

export function EngagementScopeForm({
  organizationId,
  engagementScope,
  tierOnlyPermissionCount = null,
}: {
  organizationId: string;
  engagementScope: string;
  /** Custom-role permissions that only exist on Full Client-Managed and would be removed by leaving it. */
  tierOnlyPermissionCount?: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateEngagementScopeAction, initialState);
  const [selected, setSelected] = useState(engagementScope);
  const current = isEngagementScope(engagementScope) ? engagementScope : "full_service";
  // S1-12: what saving would change, shown before the admin ticks the confirmation.
  const impact = isEngagementScope(selected) ? summarizeScopeChange(current, selected, tierOnlyPermissionCount) : null;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      <div className="space-y-2">
        {SCOPES.map((scope) => (
          <label
            key={scope.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-burgundy"
          >
            <input
              type="radio"
              name="engagement_scope"
              value={scope.value}
              checked={selected === scope.value}
              onChange={() => setSelected(scope.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-ink">{scope.label}</span>
              <span className="block text-xs text-muted">{scope.short}</span>
            </span>
          </label>
        ))}
      </div>
      <MoreDetails className="mt-0">
        {SCOPES.map((scope) => (
          <p key={scope.value}><span className="font-medium text-ink">{scope.label}:</span> {scope.description}</p>
        ))}
      </MoreDetails>

      {impact && impact.direction !== "none" && isEngagementScope(selected) && (
        <div role="status" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-ink">
          <p className="font-medium"><Tx>What this change does</Tx></p>
          <p>{describeScopeChange(current, selected, impact)}</p>
          <p className="text-muted">{impact.unchanged.join(" ")}</p>
        </div>
      )}

      <label className="flex items-start gap-2 text-xs text-ink">
        <input type="checkbox" name="confirm" value="yes" className="mt-0.5" />
        <span>
          <Tx>I understand changing the tier changes what this organisation&apos;s people can do immediately, and that leaving Full Client-Managed removes its custom roles&apos; approve-ITP, provision-login and standalone permissions.</Tx>
        </span>
      </label>

      <FormMessage error={state.error} success={pending ? null : state.message} />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save engagement scope"}
      </Button>
    </form>
  );
}
