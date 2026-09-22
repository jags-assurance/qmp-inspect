import type { ActivitySignoffProgressRow } from "./db-types";
import type { InterventionLevelTypeRow } from "@/lib/intervention-levels/types";

/**
 * Pure decision logic behind findUnclearedLowerBlockingLevel (./actions.ts), split into its own
 * non-"use server" module so R67's strict/flexible branching can be unit-tested without a Supabase
 * client (see __tests__/sequencing.test.ts) — a "use server" file's exports must all be async
 * Server Actions, so this plain sync helper can't live in actions.ts itself.
 *
 * Given the org's full level list, the level code being signed off, whether the org is in 'strict'
 * mode, and the prior sign-off rows already recorded for this activity, returns the label of the
 * first uncleared lower-sort_order level that must clear first, or null when clear to proceed.
 *
 * flexible (default): only a blocking `code` is checked at all, and only against lower BLOCKING
 * levels — exactly today's pre-R67 behaviour (findUnclearedLowerBlockingLevel's original doc
 * comment). strict: every level, blocking or not, is checked against every lower level.
 */
export function resolveUnclearedLowerLevel(
  levels: Pick<InterventionLevelTypeRow, "code" | "label" | "sort_order" | "is_blocking">[],
  code: string,
  strictMode: boolean,
  priorRows: Pick<ActivitySignoffProgressRow, "intervention" | "status">[]
): string | null {
  const thisLevel = levels.find((l) => l.code === code);
  if (!thisLevel) return null;
  if (!strictMode && !thisLevel.is_blocking) return null;

  const lowerLevels = levels.filter((l) => (strictMode || l.is_blocking) && l.sort_order < thisLevel.sort_order);
  if (lowerLevels.length === 0) return null;

  const lowerCodes = new Set(lowerLevels.map((l) => l.code));
  const uncleared = priorRows.find(
    (r) => lowerCodes.has(r.intervention) && r.status !== "signed_off" && r.status !== "proceeded_no_response"
  );
  if (!uncleared) return null;

  return lowerLevels.find((l) => l.code === uncleared.intervention)?.label ?? uncleared.intervention;
}
