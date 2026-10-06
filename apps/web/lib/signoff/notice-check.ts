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

/** Pure status calculation, reusable by batched callers. plannedDate is yyyy-mm-dd. */
export function evaluateNotice(plannedDate: string | null, requiredHours: number, label = "Hold", now = new Date()): NoticeCheck {
  if (!plannedDate) return { requiredHours, hoursUntilPlanned: null, status: "no_planned_date", message: null };
  const planned = new Date(`${plannedDate}T00:00:00`);
  const hours = Math.round(((planned.getTime() - now.getTime()) / 3_600_000) * 10) / 10;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (planned.getTime() < today.getTime()) {
    return { requiredHours, hoursUntilPlanned: hours, status: "overdue", message: `Planned date ${plannedDate} has passed.` };
  }
  // The planned day itself counts through its end, so compare against the end of that day.
  const hoursToEnd = (planned.getTime() + 86_400_000 - now.getTime()) / 3_600_000;
  if (hoursToEnd < requiredHours) {
    const days = Math.round((planned.getTime() - today.getTime()) / 86_400_000);
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
  return evaluateNotice(item?.planned_date ?? null, required, label);
}
