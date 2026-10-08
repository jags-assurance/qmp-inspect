import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const WAIVER_REASON_MIN = 10;
export const WAIVER_REASON_MAX = 1000;
/** Only the Witness level is a notify-before-work requirement, so only it can be waived. */
export const WAIVABLE_INTERVENTION = "W";

/** Pure: the reason a waiver needs, or null when it is acceptable. */
export function validateWaiverReason(raw: string): { reason: string } | { error: string } {
  const reason = raw.trim();
  if (reason.length < WAIVER_REASON_MIN) {
    return { error: `Give the written reason for waiving the notice (at least ${WAIVER_REASON_MIN} characters).` };
  }
  if (reason.length > WAIVER_REASON_MAX) return { error: `The reason is too long (max ${WAIVER_REASON_MAX} characters).` };
  return { reason };
}

/** Pure: pending intervention codes that still need notifying once waived codes are removed. */
export function remainingUnnotified(pendingCodes: string[], waivedCodes: string[]): string[] {
  const waived = new Set(waivedCodes);
  return pendingCodes.filter((c) => !waived.has(c));
}

/**
 * Labels of non-blocking intervention levels (Witness) whose sign-off row is still 'pending' (the party was
 * never notified) and that have NOT been waived for this inspection record. Best-effort: any failure returns
 * [] (the same as before the waiver existed), and a missing waiver table just means nothing is waived.
 */
export async function unnotifiedNonBlockingLevels(
  supabase: Client,
  itpItemId: string,
  inspectionRecordId?: string | null
): Promise<string[]> {
  try {
    const { data: ctx } = await supabase
      .from("itp_items")
      .select("itp_sections(itps(projects(organization_id)))")
      .eq("id", itpItemId)
      .maybeSingle<{ itp_sections: { itps: { projects: { organization_id: string } | null } | null } | null }>();
    const orgId = ctx?.itp_sections?.itps?.projects?.organization_id;
    if (!orgId) return [];
    const [{ data: levels }, { data: progress }] = await Promise.all([
      supabase.from("intervention_level_types").select("code, label, is_blocking").eq("organization_id", orgId).eq("is_blocking", false).returns<{ code: string; label: string; is_blocking: boolean }[]>(),
      supabase.from("activity_signoff_progress").select("intervention, status").eq("itp_item_id", itpItemId).eq("status", "pending").returns<{ intervention: string; status: string }[]>(),
    ]);
    const witnessCodes = new Set((levels ?? []).filter((l) => l.code === WAIVABLE_INTERVENTION).map((l) => l.code));
    const labels = new Map((levels ?? []).map((l) => [l.code, l.label]));
    let waived: string[] = [];
    if (inspectionRecordId) {
      const { data: rows, error } = await supabase
        .from("inspection_notice_waivers" as never)
        .select("intervention")
        .eq("inspection_record_id", inspectionRecordId);
      if (!error) waived = ((rows ?? []) as { intervention: string }[]).map((r) => r.intervention);
      else if (!isMissingSchemaError(error)) console.error("[waiver] lookup failed", error.message);
    }
    const pending = (progress ?? []).filter((p) => witnessCodes.has(p.intervention)).map((p) => p.intervention);
    return [...new Set(remainingUnnotified(pending, waived).map((c) => labels.get(c) ?? c))];
  } catch {
    return [];
  }
}
