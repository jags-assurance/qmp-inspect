import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { Watchlist } from "@/components/ui/watchlist";
import { TodayQueue, type TodayItem } from "@/components/domain/today-queue";
import { INTERVENTION_LEVEL_TYPES_TABLE, type InterventionLevelTypeRow } from "@/lib/intervention-levels/types";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  DEFAULT_NOTICE_PERIOD_HOURS,
  NOTICE_PERIOD_CONFIGS_TABLE,
} from "@/lib/signoff/db-types";

export interface OverdueHoldPointItem {
  id: string;
  activity: string;
  itpNumber: string;
  projectLabel: string;
  daysOpen: number;
}

/**
 * Portfolio-wide overdue hold points — the slowest part of the Admin dashboard (a 4-level nested
 * join, then two dependent lookups). Lives in its own server module so the dashboard can stream it
 * behind <Suspense> instead of every tile waiting for it. React `cache` dedupes the work so the KPI
 * tile and the watchlist card, rendered separately, share one computation per request.
 */
export const getOverdueHoldPoints = cache(async (): Promise<OverdueHoldPointItem[]> => {
  const supabase = await createSupabaseServerClient();
  const items: OverdueHoldPointItem[] = [];
  // Portfolio-wide "Overdue hold points" (new purpose: daily/actionable, real data already
  // computed for the Inspector dashboard below — same blocking-level/notice-period logic, just
  // unscoped across every organisation instead of one Inspector's own worklist, since work stuck
  // behind a hold point is exactly the kind of thing an Admin needs to watch daily too).
  interface AdminNotifiedRow {
    id: string;
    itp_item_id: string;
    intervention: string;
    notified_at: string | null;
    itp_items: {
      activity: string;
      itp_sections: {
        itps: {
          itp_number: string;
          project_id: string;
          projects: { organization_id: string; project_number: string; name: string } | null;
        } | null;
      } | null;
    } | null;
  }
  const { data: adminNotifiedRows } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select(
      "id, itp_item_id, intervention, notified_at, itp_items(activity, itp_sections(itps(itp_number, project_id, projects(organization_id, project_number, name))))"
    )
    .eq("status", "notified")
    .returns<AdminNotifiedRow[]>();

  const orgIdsForOverdue = [
    ...new Set(
      (adminNotifiedRows ?? []).map((r) => r.itp_items?.itp_sections?.itps?.projects?.organization_id).filter((id): id is string => !!id)
    ),
  ];
  const { data: levelTypesForOverdue } = orgIdsForOverdue.length
    ? await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("organization_id, code, is_blocking, default_notice_hours")
        .in("organization_id", orgIdsForOverdue)
        .eq("is_blocking", true)
        .returns<Pick<InterventionLevelTypeRow, "organization_id" | "code" | "is_blocking" | "default_notice_hours">[]>()
    : { data: [] as Pick<InterventionLevelTypeRow, "organization_id" | "code" | "is_blocking" | "default_notice_hours">[] };
  const blockingLevelByOrgCode = new Map((levelTypesForOverdue ?? []).map((l) => [`${l.organization_id}:${l.code}`, l]));

  const adminNotifiedHolds = (adminNotifiedRows ?? []).filter((row) => {
    const orgId = row.itp_items?.itp_sections?.itps?.projects?.organization_id;
    return orgId && blockingLevelByOrgCode.has(`${orgId}:${row.intervention}`);
  });

  const overdueProjectIds = [
    ...new Set(adminNotifiedHolds.map((r) => r.itp_items?.itp_sections?.itps?.project_id).filter((id): id is string => !!id)),
  ];
  const { data: adminNoticeConfigs } = overdueProjectIds.length
    ? await supabase
        .from(NOTICE_PERIOD_CONFIGS_TABLE)
        .select("project_id, intervention, hours")
        .in("intervention", ["H", ...[...blockingLevelByOrgCode.values()].map((l) => l.code)])
        .in("project_id", overdueProjectIds)
        .returns<{ project_id: string; intervention: string; hours: number }[]>()
    : { data: [] as { project_id: string; intervention: string; hours: number }[] };
  const hoursByProjectIntervention = new Map((adminNoticeConfigs ?? []).map((c) => [`${c.project_id}:${c.intervention}`, c.hours]));

  const nowMs = Date.now();
  for (const row of adminNotifiedHolds) {
    if (!row.notified_at) continue;
    const projectId = row.itp_items?.itp_sections?.itps?.project_id;
    const orgId = row.itp_items?.itp_sections?.itps?.projects?.organization_id;
    const levelType = orgId ? blockingLevelByOrgCode.get(`${orgId}:${row.intervention}`) : undefined;
    const noticeHours =
      (projectId ? hoursByProjectIntervention.get(`${projectId}:${row.intervention}`) : undefined) ??
      levelType?.default_notice_hours ??
      DEFAULT_NOTICE_PERIOD_HOURS[row.intervention] ??
      48;
    const ageMs = nowMs - new Date(row.notified_at).getTime();
    if (ageMs <= noticeHours * 60 * 60 * 1000) continue;
    const itp = row.itp_items?.itp_sections?.itps;
    items.push({
      // The row's own primary key, not itp_item_id/intervention — more than one project party
      // can each have their own notified row for the same activity+level, which collided as a
      // duplicate-key React warning when keyed on the composite instead (found live testing).
      id: row.id,
      activity: row.itp_items?.activity ?? "—",
      itpNumber: itp?.itp_number ?? "—",
      projectLabel: itp?.projects ? `${itp.projects.project_number} — ${itp.projects.name}` : "—",
      daysOpen: Math.floor(ageMs / 86_400_000),
    });
  }
  items.sort((a, b) => b.daysOpen - a.daysOpen);
  return items;
});

const CLOCK_ICON = (
  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/10 text-danger">
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4.5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

export async function OverdueHoldsTile() {
  const items = await getOverdueHoldPoints();
  return <StatCard label="Overdue hold points" value={items.length} icon={CLOCK_ICON} />;
}

export async function OverdueHoldsCard() {
  const items = await getOverdueHoldPoints();
  return (
    <Watchlist
      title="Overdue hold points"
      description="Blocking sign-offs notified past their notice period."
      items={items}
      emptyText="No overdue hold points."
      renderItem={(item) => (
        <>
          <p className="text-ink">
            <span className="doc-id mr-1 text-muted">{item.itpNumber}</span>
            {item.activity}
          </p>
          <p className="mt-0.5 flex items-center justify-between text-xs">
            <span className="text-muted">{item.projectLabel}</span>
            <span className="font-semibold text-danger">{item.daysOpen}d overdue</span>
          </p>
        </>
      )}
    />
  );
}

/**
 * The admin "Today" queue with the portfolio's overdue hold points merged in. The holds are the slow
 * query, so this streams (the dashboard shows the queue without them first); getOverdueHoldPoints is
 * cached, so the tile, the card and this share one computation per request.
 */
export async function AdminTodayWithHolds({ baseItems, description }: { baseItems: TodayItem[]; description: string }) {
  const holds = await getOverdueHoldPoints();
  const shown = holds.slice(0, 5).map<TodayItem>((h) => ({
    id: h.id,
    kind: "hold",
    title: `${h.itpNumber} — ${h.activity}`,
    meta: h.projectLabel,
    badge: `${h.daysOpen}d overdue`,
    urgency: 2,
    href: "/inspect/itps",
    actionLabel: "Review",
  }));
  if (holds.length > shown.length) {
    shown.push({
      id: "more-holds",
      kind: "hold",
      title: `+ ${holds.length - shown.length} more overdue hold points`,
      meta: "See the Overdue hold points list below",
      urgency: 2,
      href: "/inspect/itps",
    });
  }
  const items = [...shown, ...baseItems].sort((a, b) => b.urgency - a.urgency);
  return <TodayQueue description={description} items={items} emptyText="No NCRs, hold points or proposals waiting on you." />;
}
