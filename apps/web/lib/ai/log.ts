import type { SupabaseClient } from "@supabase/supabase-js";

// `ai_usage_log` isn't in the generated Database type yet (see supabase/migrations/
// 20260910060000_phase3_ai_usage_log.sql), so `.from()` can't resolve it against the Tables map.
// Casting the table name here is the one place that gap leaks in, matching apps/web/lib/ncrs/types.ts
// and apps/web/lib/itp-master/types.ts's exact pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AI_USAGE_LOG_TABLE = "ai_usage_log" as any;

export type AiFeature =
  | "itp_draft"
  | "ncr_description_draft"
  | "checklist_consistency_check"
  | "checklist_generation"
  | "report_narrative_draft";

/**
 * Minimal usage log — one row per AI feature invocation — for whoever's ai_consent-gated admin
 * screen surfaces this later (no dashboard UI is part of this task). Best-effort: a logging
 * failure never blocks the AI feature itself, so this is fire-and-forget from the caller's point
 * of view but still awaited here so a genuine outage is visible in server logs.
 */
export async function logAiUsage(
  supabase: SupabaseClient,
  params: { organizationId: string; userId: string | null; feature: AiFeature }
): Promise<void> {
  const { error } = await supabase.from(AI_USAGE_LOG_TABLE).insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    feature: params.feature,
  });

  if (error) {
    console.error("Could not write ai_usage_log row:", error.message);
  }
}
