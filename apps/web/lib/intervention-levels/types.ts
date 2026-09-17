// Domain types + table-name handle for `intervention_level_types`
// (supabase/migrations/20260917090000_configurable_intervention_levels.sql).
//
// This is what replaced the old fixed 4-value H/W/R/S enum: every organisation has its own ordered
// list of levels (seeded with the four built-ins on creation), each with a label, a sort_order, an
// is_blocking flag (Hold-equivalent levels block progress until cleared; Witness/Review/
// Surveillance-equivalent don't), and an optional default_notice_hours. Not in the generated
// Database type yet — same documented `"table" as any` cast used for every other table added after
// the last type generation (see lib/signoff/db-types.ts, lib/vault/types.ts, lib/ncrs/types.ts).
// Every read/write here is still typed via an explicit `.returns<T>()` / `.single<T>()`.

/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const INTERVENTION_LEVEL_TYPES_TABLE = "intervention_level_types" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface InterventionLevelTypeRow {
  id: string;
  organization_id: string;
  code: string;
  label: string;
  sort_order: number;
  is_blocking: boolean;
  default_notice_hours: number | null;
  created_at: string;
}

/** Sorts by sort_order, falling back to code for a stable order when two rows share a sort_order. */
export function sortLevels<T extends { sort_order: number; code: string }>(levels: T[]): T[] {
  return [...levels].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
}

// Colored pill tones, assigned by position in the org's own sorted level list rather than keyed off
// a fixed code — so a custom 5th ("Regulatory Compliance Review") level gets its own distinct tone
// too, instead of falling back to some generic "unknown" look. The first four entries intentionally
// match the original H/W/R/S tones (burgundy/gold/info/success) so every existing org's grid renders
// pixel-identical to before this feature; anything past the fourth level cycles through the palette.
const TONE_PALETTE = [
  "bg-burgundy/10 text-burgundy",
  "bg-gold/20 text-[color:var(--color-burgundy-dark)]",
  "bg-info/10 text-info",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
  "bg-muted/15 text-ink",
] as const;

export function toneClassForLevelIndex(index: number): string {
  return TONE_PALETTE[index % TONE_PALETTE.length];
}

/** Fallback notice periods (hours) used only when an org's level row has no default_notice_hours
 *  AND the project has no notice_period_configs override — mirrors the original hardcoded spec
 *  defaults (Hold=48h, Witness=24h) for the two levels that ever had one. */
export const FALLBACK_NOTICE_PERIOD_HOURS: Record<string, number> = { H: 48, W: 24 };
