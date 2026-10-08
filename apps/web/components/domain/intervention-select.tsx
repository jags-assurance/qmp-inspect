"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { setInterventionAction } from "@/lib/itps/actions";
import type { InterventionLevel } from "@jags/shared-types";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
  isIssued = false,
}: {
  itpId: string;
  itpItemId: string;
  projectPartyId: string;
  value: InterventionLevel | null;
  editable: boolean;
  levels: InterventionLevelOption[];
  /** The ITP is approved/client-accepted: a level change is an edit-after-issue, so it asks for a
   *  reason and the server records it as a new revision (same rule as adding/editing an activity). */
  isIssued?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { ask, dialog } = useConfirm();

  async function handleChange() {
    if (isIssued) {
      const reason = await ask({
        title: "Change sign-off level",
        message: "This ITP has already been issued. Changing a sign-off level creates a new revision.",
        confirmLabel: "Change level",
        reason: { label: "Reason for this change", required: true },
      });
      if (!reason) {
        if (selectRef.current) selectRef.current.value = value ?? "";
        return;
      }
      if (reasonRef.current) reasonRef.current.value = reason;
    }
    formRef.current?.requestSubmit();
  }

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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await setInterventionAction(formData);
      if (result.error) {
        setError(result.error);
        if (selectRef.current) selectRef.current.value = value ?? "";
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="inline-flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input type="hidden" name="project_party_id" value={projectPartyId} />
      <input type="hidden" name="revision_reason" ref={reasonRef} />
      {dialog}
      {value && (
        <span
          title={labelOf(value)}
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${toneClass(value)}`}
        >
          {value}
        </span>
      )}
      <select
        ref={selectRef}
        name="intervention"
        defaultValue={value ?? ""}
        onChange={handleChange}
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
      {error && (
        <span role="alert" className="basis-full text-xs text-danger">
          {error}
        </span>
      )}
    </form>
  );
}
