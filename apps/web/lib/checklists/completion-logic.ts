// Pure decision logic pulled out of completeInspectionCore (lib/checklists/actions.ts) so it can be
// unit-tested without a live Supabase/Next.js request context — completeInspectionCore itself calls
// createSupabaseServerClient(), which depends on next/headers' cookies() and only works inside a real
// request. No behavior change: these are the exact same checks/strings that used to live inline.
//
// Round-table finding this guards: a checklist with zero items used to silently "complete" as
// overall_result='pass' because `.some()` over an empty set is vacuously false — indistinguishable
// downstream from a real, evidenced pass. See validateChecklistItemsAnswered's itemIds.size === 0
// check below.
import type { ChecklistResponseResult, OverallResult } from "./db-types";

/**
 * Returns an error message if the checklist isn't ready to be completed (no items at all, or at
 * least one item still unanswered), or null if it's clear to complete.
 */
export function validateChecklistItemsAnswered(
  itemIds: Set<string>,
  responseByItem: Map<string, ChecklistResponseResult>
): string | null {
  if (itemIds.size === 0) {
    return "This checklist has no items yet — add at least one before it can be completed.";
  }
  const missing = [...itemIds].some((id) => !responseByItem.has(id));
  if (missing) {
    return "Every checklist item needs a Yes / No / N-A response before you can complete the inspection.";
  }
  return null;
}

/** Any 'no' fails the inspection outright; otherwise any 'na' makes it partial; else it's a clean pass. */
export function computeOverallResult(results: ChecklistResponseResult[]): OverallResult {
  return results.includes("no") ? "fail" : results.includes("na") ? "partial" : "pass";
}
