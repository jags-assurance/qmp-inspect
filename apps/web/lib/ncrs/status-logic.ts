// Pure decision logic pulled out of setNcrStatusAction (lib/ncrs/actions.ts) so it can be
// unit-tested without a live Supabase/Next.js request context — setNcrStatusAction itself calls
// createSupabaseServerClient(), which depends on next/headers' cookies() and only works inside a
// real request. No behavior change: same allow-list and same guard as before.
//
// Round-table finding this guards: this action previously accepted ANY status value with no
// validation, including 'closed' — bypassing updateNcrAction's own CAPA-completeness gate (root
// cause / corrective action / verification notes required before closure). See QUICK_ACTION_STATUSES.
import type { NcrStatus } from "./types";

export const QUICK_ACTION_STATUSES: readonly NcrStatus[] = ["in_progress", "pending_verification"];

/**
 * Resolves a requested status transition for the plain, non-CAPA quick-action button. Returns the
 * validated status, or null if the ncrId is missing or the status isn't one of the two allowed
 * non-terminal transitions — deliberately excludes 'closed', which must only ever be set via
 * updateNcrAction's CAPA-gated close-out flow.
 */
export function resolveQuickActionStatus(ncrId: string, status: string): NcrStatus | null {
  if (!ncrId || !QUICK_ACTION_STATUSES.includes(status as NcrStatus)) return null;
  return status as NcrStatus;
}
