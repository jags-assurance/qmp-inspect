"use client";

import { ITP_PHASES, ITP_PHASE_LABEL, type ItpPhase } from "@/lib/itps/phase";
import { Tx } from "@/components/domain/tx";

// R23: optional phase filter for the ITP register — same pattern as DisciplineFilterForm alongside
// it (a plain GET <select> that submits on change), just over the fixed development/execution/
// handover union instead of a fetched list.
export function PhaseFilterForm({ selectedPhase }: { selectedPhase: ItpPhase | null }) {
  return (
    <form className="max-w-xs">
      <label htmlFor="phase" className="block text-sm font-medium text-ink">
        <Tx>Filter by phase</Tx>
      </label>
      <select
        id="phase"
        name="phase"
        defaultValue={selectedPhase ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      >
        <option value=""><Tx>All phases</Tx></option>
        {ITP_PHASES.map((phase) => (
          <option key={phase} value={phase}>
            {ITP_PHASE_LABEL[phase]}
          </option>
        ))}
      </select>
    </form>
  );
}
