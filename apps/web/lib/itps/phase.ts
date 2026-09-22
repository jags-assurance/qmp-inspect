// R23: three-phase ITP lifecycle (Development / Execution / Handover).
//
// `phase` is a real, database-derived column (supabase/migrations/20260923020000_itp_lifecycle_phase.sql)
// kept in sync by triggers off itps.status and activity_signoff_progress — never something set
// directly by application code. This file is just the shared display/filtering vocabulary for it,
// mirroring the STATUS_TONE/STATUS_LABEL pattern in app/inspect/itps/[id]/page.tsx.
//
// Not in the generated Database type's narrower "Row" unions elsewhere in the app (it IS in
// database.ts's itps.Row/Insert/Update as a plain `string`), so this file is the one place the
// three real values are enumerated as a proper union.

export const ITP_PHASES = ["development", "execution", "handover"] as const;
export type ItpPhase = (typeof ITP_PHASES)[number];

export const ITP_PHASE_LABEL: Record<ItpPhase, string> = {
  development: "Development",
  execution: "Execution",
  handover: "Handover",
};

export const ITP_PHASE_TONE: Record<ItpPhase, "neutral" | "warning" | "success"> = {
  development: "neutral",
  execution: "warning",
  handover: "success",
};

/** Narrows an arbitrary phase string (e.g. straight off a Supabase row) to the known union, falling
 *  back to 'development' for anything unrecognised rather than rendering a blank badge. */
export function normalizeItpPhase(phase: string | null | undefined): ItpPhase {
  return (ITP_PHASES as readonly string[]).includes(phase ?? "") ? (phase as ItpPhase) : "development";
}
