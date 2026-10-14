"use client";

import { useActionState } from "react";
import { updateItpSequencingModeAction } from "@/lib/intervention-levels/actions";
import { Button } from "@/components/ui/button";
import { MoreDetails } from "@/components/domain/more-details";

interface SequencingModeState {
  error: string | null;
}

const initialState: SequencingModeState = { error: null };

const MODES: { value: string; label: string; short: string; description: string }[] = [
  {
    value: "flexible",
    label: "Flexible (default)",
    short: "Only blocking levels like Hold must clear in order.",
    description:
      "Only blocking levels like Hold must clear in sort_order before each other. Non-blocking levels (e.g. Witness, Review) can be signed off in any order.",
  },
  {
    value: "strict",
    label: "Strict",
    short: "Every level must be signed off in order.",
    description:
      "Every level must be signed off in sort_order order, regardless of whether it's blocking — a lower-ordered level (blocking or not) must clear before a higher-ordered one can be signed.",
  },
];

export function ItpSequencingModeForm({
  organizationId,
  itpSequencingMode,
}: {
  organizationId: string;
  itpSequencingMode: string;
}) {
  const [state, formAction, pending] = useActionState(updateItpSequencingModeAction, initialState);

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
              name="itp_sequencing_mode"
              value={mode.value}
              defaultChecked={itpSequencingMode === mode.value}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-ink">{mode.label}</span>
              <span className="block text-xs text-muted">{mode.short}</span>
            </span>
          </label>
        ))}
      </div>
      <MoreDetails className="mt-0">
        {MODES.map((mode) => (
          <p key={mode.value}><span className="font-medium text-ink">{mode.label}:</span> {mode.description}</p>
        ))}
      </MoreDetails>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save sequencing mode"}
      </Button>
    </form>
  );
}
