"use client";

import { useRef } from "react";
import { setInterventionAction } from "@/lib/itps/actions";
import type { InterventionLevel } from "@jags/shared-types";
import { toneClassForLevelIndex } from "@/lib/intervention-levels/types";

export interface InterventionLevelOption {
  code: string;
  label: string;
}

/**
 * One cell in the ITP's per-party intervention grid. Auto-submits on change so setting a party's
 * level on an activity is a single click, not a separate save step. Sign-off progress for the same
 * (activity, party) pair (R66-R81) is a sibling concern rendered next to this by the ITP detail page
 * via SignoffCell, not part of this component.
 *
 * `levels` is this activity's ORGANISATION's configured intervention_level_types, in sort_order —
 * no longer a hardcoded 4-value H/W/R/S list, so a custom 5th level an admin adds under
 * /inspect/organisation/intervention-levels shows up here automatically. The tone (pill color) is
 * assigned by position in that list, not by a fixed code, so a custom level gets its own distinct
 * color instead of falling back to a generic look.
 */
export function InterventionSelect({
  itpId,
  itpItemId,
  projectPartyId,
  value,
  editable,
  levels,
}: {
  itpId: string;
  itpItemId: string;
  projectPartyId: string;
  value: InterventionLevel | null;
  editable: boolean;
  levels: InterventionLevelOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const indexOf = (code: string) => levels.findIndex((l) => l.code === code);
  const labelOf = (code: string) => levels.find((l) => l.code === code)?.label ?? code;
  const toneClass = (code: string) => toneClassForLevelIndex(Math.max(indexOf(code), 0));

  if (!editable) {
    return value ? (
      <span
        title={labelOf(value)}
        className={`inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold ${toneClass(value)}`}
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
          title={labelOf(value)}
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${toneClass(value)}`}
        >
          {value}
        </span>
      )}
      <select
        name="intervention"
        defaultValue={value ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        title={value ? labelOf(value) : "No intervention"}
        aria-label="Intervention level"
        className="h-7 w-14 rounded border border-border bg-surface text-center text-xs font-semibold text-muted outline-none focus:border-burgundy"
      >
        <option value="">—</option>
        {levels.map((level) => (
          <option key={level.code} value={level.code}>
            {level.code}
          </option>
        ))}
      </select>
    </form>
  );
}
