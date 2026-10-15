"use client";

import { ITP_PHASES, ITP_PHASE_LABEL, type ItpPhase } from "@/lib/itps/phase";
import { Tx } from "@/components/domain/tx";
import { useSetFilterParam } from "@/lib/hooks/use-filter-param";

// R23: optional phase filter for the ITP register — same pattern as DisciplineFilterForm alongside
// it (a plain GET <select> that submits on change), just over the fixed development/execution/
// handover union instead of a fetched list.
export function PhaseFilterForm({ selectedPhase }: { selectedPhase: ItpPhase | null }) {
  const setParam = useSetFilterParam();
  return (
    <form className="w-full md:w-auto">
      <label htmlFor="phase" className="block text-xs font-medium text-muted">
        <Tx>Filter by phase</Tx>
      </label>
      <select
        id="phase"
        name="phase"
        defaultValue={selectedPhase ?? ""}
        onChange={(e) => setParam("phase", e.currentTarget.value)}
        className="mt-1 min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink [@media(pointer:coarse)]:min-h-11 md:w-auto"
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
