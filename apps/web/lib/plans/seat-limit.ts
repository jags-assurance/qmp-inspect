// Plain (non "use server") helpers for seat-limit enforcement. The hard gate is the
// access_grants_org_seat_limit database trigger; this file only turns its outcome into clear messages,
// parses the Admin override fields and records the override. No limit set => nothing changes.
import type { SupabaseClient } from "@supabase/supabase-js";

export const SEAT_LIMIT_MARKER = "seat limit";
export const MIN_OVERRIDE_REASON = 5;

export interface SeatUsage {
  used: number;
  limit: number | null;
  /** True when adding one more distinct user would exceed the limit. */
  atLimit: boolean;
  /** True when usage is already above the limit (e.g. after an override or a lowered limit). */
  overLimit: boolean;
  /** 0-100, or null when unlimited. */
  percent: number | null;
}

export function summariseSeatUsage(used: number, limit: number | null | undefined): SeatUsage {
  if (limit == null) return { used, limit: null, atLimit: false, overLimit: false, percent: null };
  const percent = limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  return { used, limit, atLimit: used >= limit, overLimit: used > limit, percent };
}

export function isSeatLimitError(message: string | null | undefined): boolean {
  return !!message && message.toLowerCase().includes(SEAT_LIMIT_MARKER);
}

export interface SeatOverrideRequest {
  requested: boolean;
  reason: string;
  /** Set when an override was requested but is not usable (no reason). */
  error: string | null;
}

export function parseSeatOverride(formData: FormData): SeatOverrideRequest {
  const raw = String(formData.get("seat_override") ?? "");
  const requested = raw === "on" || raw === "true" || raw === "1";
  const reason = String(formData.get("seat_override_reason") ?? "").trim();
  if (requested && reason.length < MIN_OVERRIDE_REASON) {
    return { requested, reason, error: `Give a reason (at least ${MIN_OVERRIDE_REASON} characters) to override the seat limit.` };
  }
  return { requested, reason, error: null };
}

/** The message shown when the trigger refuses an insert. Only an Admin is told about the override. */
export function seatLimitMessage(dbMessage: string, isAdmin: boolean): string {
  return isAdmin
    ? `${dbMessage} As a JAGS Admin you can tick "Override seat limit" and give a reason; the override is audited.`
    : `${dbMessage} Ask a JAGS Admin to raise the limit or approve an override.`;
}

/** Writes the single-use override the trigger looks for. Returns the override id, or null on failure. */
export async function grantSeatOverride(
  client: SupabaseClient,
  params: { organizationId: string; userId: string; reason: string; actorId: string }
): Promise<string | null> {
  const { data, error } = await client
    .from("seat_limit_overrides")
    .insert({
      organization_id: params.organizationId,
      user_id: params.userId,
      reason: params.reason,
      granted_by: params.actorId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return null;
  return data.id;
}

/** Removes an override that was not consumed (the retried insert failed for another reason). */
export async function discardSeatOverride(client: SupabaseClient, id: string): Promise<void> {
  await client.from("seat_limit_overrides").delete().eq("id", id).is("consumed_at", null);
}
