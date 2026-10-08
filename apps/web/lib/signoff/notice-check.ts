import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_NOTICE_PERIOD_HOURS, NOTICE_PERIOD_CONFIGS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type NoticeStatus = "ok" | "short_notice" | "overdue" | "no_planned_date";

export interface NoticeCheck {
  requiredHours: number;
  /** Hours from now until the planned date (start of that day); negative when past. null without a planned date. */
  hoursUntilPlanned: number | null;
  status: NoticeStatus;
  message: string | null;
}

function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Offset (ms) of `tz` from UTC at the given instant: local = utc + offset. */
function zoneOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which calendar day `ymd` (yyyy-mm-dd) starts in `tz`. */
export function startOfDayInZone(ymd: string, tz: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - zoneOffsetMs(guess, tz);
  // One more pass settles days where the offset changes (daylight saving).
  instant = guess - zoneOffsetMs(instant, tz);
  return instant;
}

/** The calendar day (yyyy-mm-dd) of `now` in `tz`. */
export function dayInZone(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Pure status calculation, reusable by batched callers. plannedDate is yyyy-mm-dd. With `timeZone` (the
 * project's IANA zone, S4-19) "today" and the start of the planned day are the project's, not the
 * server's; without it the previous server-local behaviour applies.
 */
export function evaluateNotice(
  plannedDate: string | null,
  requiredHours: number,
  label = "Hold",
  now = new Date(),
  timeZone?: string | null
): NoticeCheck {
  if (!plannedDate) return { requiredHours, hoursUntilPlanned: null, status: "no_planned_date", message: null };
  const tz = validTimeZone(timeZone);
  let plannedStart: number;
  let todayStart: number;
  let dayLength = 86_400_000;
  if (tz) {
    plannedStart = startOfDayInZone(plannedDate, tz);
    todayStart = startOfDayInZone(dayInZone(now, tz), tz);
    const next = new Date(`${plannedDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    dayLength = startOfDayInZone(next.toISOString().slice(0, 10), tz) - plannedStart;
  } else {
    plannedStart = new Date(`${plannedDate}T00:00:00`).getTime();
    todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const hours = Math.round(((plannedStart - now.getTime()) / 3_600_000) * 10) / 10;
  if (plannedStart < todayStart) {
    return { requiredHours, hoursUntilPlanned: hours, status: "overdue", message: `Planned date ${plannedDate} has passed.` };
  }
  // The planned day itself counts through its end, so compare against the end of that day.
  const hoursToEnd = (plannedStart + dayLength - now.getTime()) / 3_600_000;
  if (hoursToEnd < requiredHours) {
    const days = Math.round((plannedStart - todayStart) / 86_400_000);
    const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    return {
      requiredHours,
      hoursUntilPlanned: hours,
      status: "short_notice",
      message: `${label} needs ${requiredHours} h notice - planned for ${when}; notify the party now.`,
    };
  }
  return { requiredHours, hoursUntilPlanned: hours, status: "ok", message: null };
}

/**
 * Same precedence as getNoticePeriodHours in lib/signoff/actions.ts (item override, project config,
 * org level default, built-in fallback) plus the planned-date comparison. Warning only, never a block.
 */
export async function getNoticeCheck(supabase: Client, itpItemId: string, intervention: string): Promise<NoticeCheck> {
  const { data: item } = await supabase
    .from("itp_items")
    .select("planned_date, notice_hours_override, itp_sections(itps(project_id, projects(organization_id)))")
    .eq("id", itpItemId)
    .maybeSingle<{
      planned_date: string | null;
      notice_hours_override: number | null;
      itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null;
    }>();
  const projectId = item?.itp_sections?.itps?.project_id ?? null;
  const orgId = item?.itp_sections?.itps?.projects?.organization_id ?? null;

  let hours: number | null = item?.notice_hours_override ?? null;
  if (hours == null && projectId) {
    const { data: cfg } = await supabase
      .from(NOTICE_PERIOD_CONFIGS_TABLE)
      .select("hours")
      .eq("project_id", projectId)
      .eq("intervention", intervention)
      .maybeSingle<{ hours: number | null }>();
    hours = cfg?.hours ?? null;
  }
  let label = intervention === "H" ? "Hold" : intervention === "W" ? "Witness" : "Intervention";
  if (hours == null && orgId) {
    const { data: lt } = await supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("label, default_notice_hours")
      .eq("organization_id", orgId)
      .eq("code", intervention)
      .maybeSingle<{ label: string | null; default_notice_hours: number | null }>();
    hours = lt?.default_notice_hours ?? null;
    if (lt?.label) label = lt.label;
  }
  const required = hours ?? DEFAULT_NOTICE_PERIOD_HOURS[intervention] ?? 24;
  // Project time zone (projects.timezone, migration 20261104000500); a read error just means server-local.
  let timeZone: string | null = null;
  if (projectId) {
    const { data: tzRow, error: tzError } = await supabase.from("projects").select("timezone").eq("id", projectId).maybeSingle<{ timezone: string | null }>();
    if (!tzError) timeZone = tzRow?.timezone ?? null;
  }
  return evaluateNotice(item?.planned_date ?? null, required, label, new Date(), timeZone);
}
