"use client";

import { useActionState } from "react";
import { updateItpSequencingModeAction } from "@/lib/intervention-levels/actions";
import { Button } from "@/components/ui/button";

interface SequencingModeState {
  error: string | null;
}

const initialState: SequencingModeState = { error: null };

const MODES: { value: string; label: string; description: string }[] = [
  {
    value: "flexible",
    label: "Flexible (default)",
    description:
      "Only blocking levels like Hold must clear in sort_order before each other. Non-blocking levels (e.g. Witness, Review) can be signed off in any order.",
  },
  {
    value: "strict",
    label: "Strict",
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
              <span className="block text-xs text-muted">{mode.description}</span>
            </span>
          </label>
        ))}
      </div>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save sequencing mode"}
      </Button>
    </form>
  );
}
