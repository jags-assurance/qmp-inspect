import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { Watchlist } from "@/components/ui/watchlist";
import { TodayQueue, type TodayItem } from "@/components/domain/today-queue";

export interface OverdueHoldPointItem {
  id: string;
  activity: string;
  itpNumber: string;
  projectLabel: string;
  daysOpen: number;
}

/**
 * Portfolio-wide overdue hold points — one database round trip. This used to be a 4-level nested
 * embed plus two dependent lookups filtered in JavaScript (~1.2s under row-level security); the
 * overdue_hold_points() function (20261002140000_overdue_hold_points_function.sql) does the access
 * check once per project and returns the finished list in ~12ms. Lives in its own server module so
 * the dashboard can stream it behind <Suspense> instead of every tile waiting for it. React `cache`
 * dedupes the work so the KPI tile and the watchlist card, rendered separately, share one call.
 */
export const getOverdueHoldPoints = cache(async (): Promise<OverdueHoldPointItem[]> => {
  const supabase = await createSupabaseServerClient();
  // The function isn't in the generated Database type yet — same narrow, documented escape hatch
  // used for acknowledge_handover().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.rpc as any)("overdue_hold_points");
  return ((data ?? []) as { id: string; activity: string; itp_number: string; project_label: string; days_open: number }[]).map(
    (row) => ({
      id: row.id,
      activity: row.activity ?? "—",
      itpNumber: row.itp_number ?? "—",
      projectLabel: row.project_label,
      daysOpen: row.days_open,
    })
  );
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
