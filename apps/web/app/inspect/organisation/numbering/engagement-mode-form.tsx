"use client";

import { useActionState } from "react";
import { updateEngagementModeAction, type NumberingSettingsState } from "@/lib/numbering/actions";
import { Button } from "@/components/ui/button";

const initialState: NumberingSettingsState = { error: null };

const MODES: { value: string; label: string; description: string }[] = [
  { value: "jags_led", label: "JAGS-led", description: "Full JAGS branding across every document." },
  { value: "co_branded", label: "Co-branded", description: "JAGS and client branding shown together." },
  {
    value: "white_label",
    label: "White-label",
    description: "No JAGS branding on client documents.",
  },
];

export function EngagementModeForm({
  organizationId,
  engagementMode,
}: {
  organizationId: string;
  engagementMode: string;
}) {
  const [state, formAction, pending] = useActionState(updateEngagementModeAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      <div className="space-y-2">
        {MODES.map((mode) => (
          <label
            key={mode.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-burgundy"
          >
            <input
              type="radio"
              name="engagement_mode"
              value={mode.value}
              defaultChecked={engagementMode === mode.value}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-ink">{mode.label}</span>
              <span className="block text-xs text-muted">{mode.description}</span>
            </span>
          </label>
        ))}
      </div>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save engagement mode"}
      </Button>
    </form>
  );
}
