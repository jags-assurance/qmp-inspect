"use client";

import { useRef } from "react";
import { setInterventionAction } from "@/lib/itps/actions";
import { INTERVENTION_LEVELS, INTERVENTION_LEVEL_LABELS, type InterventionLevel } from "@jags/shared-types";

// Colored pill tones for the four intervention levels (Hold / Witness / Review / Surveillance),
// matching the UI reference screens: H=burgundy, W=gold, R=blue, S=green.
const TONE_CLASS: Record<InterventionLevel, string> = {
  H: "bg-burgundy/10 text-burgundy",
  W: "bg-gold/20 text-[color:var(--color-burgundy-dark)]",
  R: "bg-info/10 text-info",
  S: "bg-success/10 text-success",
};

/**
 * One cell in the ITP's per-party intervention grid. Auto-submits on change so setting a party's
 * Hold/Witness/Review/Surveillance level on an activity is a single click, not a separate save step.
 * Sign-off progress for the same (activity, party) pair (R66-R81) is a sibling concern rendered
 * next to this by the ITP detail page via SignoffCell, not part of this component.
 */
export function InterventionSelect({
  itpId,
  itpItemId,
  projectPartyId,
  value,
  editable,
}: {
  itpId: string;
  itpItemId: string;
  projectPartyId: string;
  value: InterventionLevel | null;
  editable: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (!editable) {
    return value ? (
      <span
        title={INTERVENTION_LEVEL_LABELS[value]}
        className={`inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold ${TONE_CLASS[value]}`}
      >
        {value}
      </span>
    ) : (
      <span className="text-xs text-muted">—</span>
    );
  }

  return (
    <form ref={formRef} action={setInterventionAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input type="hidden" name="project_party_id" value={projectPartyId} />
      {value && (
        <span
          title={INTERVENTION_LEVEL_LABELS[value]}
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${TONE_CLASS[value]}`}
        >
          {value}
        </span>
      )}
      <select
        name="intervention"
        defaultValue={value ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        title={value ? INTERVENTION_LEVEL_LABELS[value] : "No intervention"}
        aria-label="Intervention level"
        className="h-7 w-14 rounded border border-border bg-surface text-center text-xs font-semibold text-muted outline-none focus:border-burgundy"
      >
        <option value="">—</option>
        {INTERVENTION_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </form>
  );
}
