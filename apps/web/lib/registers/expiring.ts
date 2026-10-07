import type { SupabaseClient } from "@supabase/supabase-js";
import type { TodayItem } from "@/components/domain/today-queue";
import { CALIBRATION_REGISTER_TABLE, PERSONNEL_CERTIFICATIONS_TABLE, WELDER_QUALIFICATION_REGISTER_TABLE } from "./types";
import { daysUntil } from "./status";
import { isRegisterRowActive, type RegisterRowMeta } from "./lifecycle";
import { fetchAll } from "@/lib/supabase/fetch-all";

export interface ExpiringRegisterCounts {
  expired: number;
  /** Lapsing within `withinDays`. */
  expiringSoon: number;
  withinDays: number;
}

/** Pure: counts dates that are past or within the window, ignoring retired/superseded rows. */
export function countExpiring(rows: (RegisterRowMeta & { date: string })[], withinDays: number, today?: Date): ExpiringRegisterCounts {
  let expired = 0;
  let expiringSoon = 0;
  for (const r of rows) {
    if (!isRegisterRowActive(r)) continue;
    const d = daysUntil(r.date, today);
    if (d < 0) expired += 1;
    else if (d <= withinDays) expiringSoon += 1;
  }
  return { expired, expiringSoon, withinDays };
}

/** Today-queue item for the dashboards ("3 calibrations expire this week"), or null when nothing is due. */
export function buildExpiringRegistersTodayItem(counts: ExpiringRegisterCounts, href = "/inspect/projects"): TodayItem | null {
  if (counts.expired === 0 && counts.expiringSoon === 0) return null;
  const parts = [
    counts.expired > 0 ? `${counts.expired} expired` : null,
    counts.expiringSoon > 0 ? `${counts.expiringSoon} expiring within ${counts.withinDays} days` : null,
  ].filter(Boolean);
  return {
    id: "register-expiry",
    kind: "inspection",
    title: `Register clearances: ${parts.join(", ")}`,
    meta: "Calibrations, welder qualifications and personnel certificates",
    urgency: counts.expired > 0 ? 2 : 1,
    href,
    actionLabel: "Review",
  } as TodayItem;
}

/** Counts across every project the caller can see (RLS-scoped). Returns zeros if the reads fail. */
export async function getExpiringRegisterCounts(supabase: SupabaseClient, withinDays = 7): Promise<ExpiringRegisterCounts> {
  const horizon = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const load = async (table: unknown, dateColumn: string) => {
    const run = (withLifecycle: boolean) =>
      fetchAll<RegisterRowMeta & Record<string, string>>((from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registers tables aren't in the generated types
        (supabase as any).from(table).select(withLifecycle ? `id, ${dateColumn}, lifecycle_status` : `id, ${dateColumn}`).lte(dateColumn, horizon).order("id").range(from, to)
      );
    try {
      return await run(true);
    } catch {
      return await run(false);
    }
  };
  try {
    const [cal, wel, per] = await Promise.all([
      load(CALIBRATION_REGISTER_TABLE, "due_date"),
      load(WELDER_QUALIFICATION_REGISTER_TABLE, "expiry_date"),
      load(PERSONNEL_CERTIFICATIONS_TABLE, "expiry_date"),
    ]);
    return countExpiring(
      [...cal.map((r) => ({ ...r, date: r.due_date })), ...wel.map((r) => ({ ...r, date: r.expiry_date })), ...per.map((r) => ({ ...r, date: r.expiry_date }))],
      withinDays
    );
  } catch {
    return { expired: 0, expiringSoon: 0, withinDays };
  }
}
