import type { SupabaseClient } from "@supabase/supabase-js";

// `ai_usage_log` isn't in the generated Database type yet (see supabase/migrations/
// 20260910060000_phase3_ai_usage_log.sql, extended by 20260920030000_ai_audit_trail.sql), so
// `.from()` can't resolve it against the Tables map. Casting the table name here is the one place
// that gap leaks in, matching apps/web/lib/ncrs/types.ts and apps/web/lib/itp-master/types.ts's
// exact pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AI_USAGE_LOG_TABLE = "ai_usage_log" as any;

export type AiFeature =
  | "itp_draft"
  | "ncr_description_draft"
  | "checklist_consistency_check"
  | "checklist_generation"
  | "report_narrative_draft"
  | "ncr_root_cause_suggestion"
  | "standalone_measurement_suggestion"
  | "calibration_register_extraction"
  | "welder_register_extraction"
  | "material_register_extraction"
  | "content_translation"
  | "project_qa"
  | "text_cleanup"
  | "report_pack_summary";

export type AiReviewDecision = "accepted_as_is" | "edited_and_accepted" | "discarded";

export interface LogAiUsageParams {
  organizationId: string;
  userId: string | null;
  feature: AiFeature;
  /** Which model actually produced this draft (e.g. "gemini-2.5-pro") — see
   *  lib/ai/gemini-provider.ts's exported `getGeminiModel`. */
  modelId?: string | null;
  /** Which version of THIS feature's prompt template was used — see PROMPT_VERSIONS in
   *  lib/ai/gemini-provider.ts. Lets a later prompt-wording change be told apart from an earlier one
   *  when auditing why two drafts of the same kind differ. */
  promptVersion?: string | null;
  /** Feature-specific grounding reference — e.g. `{ vaultDocumentIds, revisions }` for an ITP draft,
   *  `{ itpItemId }` for a checklist draft. Free-form because "the source" means something different
   *  per feature; always JSON-serializable. */
  sourceRef?: Record<string, unknown> | null;
  /** The raw AI draft output, exactly as returned by the provider — never mutated after this insert.
   *  This is what makes it possible to answer "what did the AI actually suggest" after a human has
   *  since edited it into something else. */
  aiResponse: unknown;
}

/**
 * One row per AI feature invocation — now a real audit-trail row (20260920030000_ai_audit_trail.sql),
 * not just a usage counter. Best-effort: a logging failure never blocks the AI feature itself, so
 * this is fire-and-forget from the caller's point of view but still awaited here so a genuine outage
 * is visible in server logs. Returns the new row's id so the caller can thread it through to the
 * later review/confirm step (see recordAiReviewDecision) — null if the insert failed.
 */
export async function logAiUsage(supabase: SupabaseClient, params: LogAiUsageParams): Promise<string | null> {
  const { data, error } = await supabase
    .from(AI_USAGE_LOG_TABLE)
    .insert({
      organization_id: params.organizationId,
      user_id: params.userId,
      feature: params.feature,
      model_id: params.modelId ?? null,
      prompt_version: params.promptVersion ?? null,
      source_ref: params.sourceRef ?? null,
      ai_response: params.aiResponse ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    console.error("Could not write ai_usage_log row:", error?.message);
    return null;
  }
  return data.id;
}

export interface RecordAiReviewDecisionParams {
  /** The id returned by the logAiUsage() call this review is closing out. */
  logId: string;
  reviewedBy: string;
  /** What kind of record the draft became, e.g. "itp", "ncr", "inspection_narrative", "fat_narrative". */
  targetType: string;
  targetId: string;
  /** The final, human-approved version — kept separate from ai_response (the original draft),
   *  never overwriting it. */
  reviewedResponse: unknown;
  decision: AiReviewDecision;
}

/**
 * Closes out an AI-usage-log row with the human review outcome, once a draft from logAiUsage() has
 * been confirmed (edited or not) into a real record. Deliberately a separate call from logAiUsage
 * itself — the draft and the review happen in two different server actions (generate, then create/
 * save), often on two different requests, sometimes by two different people. Best-effort, same
 * reasoning as logAiUsage: never blocks the caller's own success path.
 */
export async function recordAiReviewDecision(supabase: SupabaseClient, params: RecordAiReviewDecisionParams): Promise<void> {
  const { error } = await supabase
    .from(AI_USAGE_LOG_TABLE)
    .update({
      reviewed_by: params.reviewedBy,
      reviewed_at: new Date().toISOString(),
      target_type: params.targetType,
      target_id: params.targetId,
      reviewed_response: params.reviewedResponse ?? null,
      decision: params.decision,
    })
    .eq("id", params.logId);

  if (error) {
    console.error("Could not record AI review decision on ai_usage_log:", error.message);
  }
}
