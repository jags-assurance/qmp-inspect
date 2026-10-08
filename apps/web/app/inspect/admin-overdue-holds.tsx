import { cache } from "react";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { Watchlist } from "@/components/ui/watchlist";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

export interface OverdueHoldPointItem {
  id: string;
  itpId: string | null;
  activity: string;
  itpNumber: string;
  projectLabel: string;
  daysOpen: number;
  /** "Notice period passed" or "Planned date passed". */
  reason: string;
  plannedDate: string | null;
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
  return (
    (data ?? []) as {
      id: string;
      itp_id: string | null;
      activity: string;
      itp_number: string;
      project_label: string;
      days_open: number;
      reason?: string | null;
      planned_date?: string | null;
    }[]
  ).map(
    (row) => ({
      id: row.id,
      itpId: row.itp_id,
      activity: row.activity ?? "—",
      itpNumber: row.itp_number ?? "—",
      projectLabel: row.project_label,
      daysOpen: row.days_open,
      reason: row.reason ?? "Notice period passed",
      plannedDate: row.planned_date ?? null,
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
  return <StatCard label="Overdue hold points" value={items.length} href="#overdue-holds" icon={CLOCK_ICON} />;
}

export async function OverdueHoldsCard() {
  const tl = await getTranslator();
  const items = await getOverdueHoldPoints();
  return (
    <Watchlist
      anchorId="overdue-holds"
      title={tl("Overdue hold points")}
      total={items.length}
      description="Blocking sign-offs notified past their notice period, or still open after the activity's planned date."
      items={items}
      emptyText="No overdue hold points."
      renderItem={(item) => (
        <Link
          href={item.itpId ? `/inspect/itps?itp=${item.itpId}` : "/inspect/itps"}
          className="block rounded-md px-1.5 py-1 hover:bg-off-white"
        >
          <span className="block text-ink">{item.activity}</span>
          <span className="mt-0.5 flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-muted" title={`${item.itpNumber} · ${item.projectLabel}`}>
              {item.projectLabel}
            </span>
            <span className="shrink-0 whitespace-nowrap font-semibold text-danger">{item.daysOpen}<T>d overdue</T></span>
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {item.reason}
            {item.plannedDate ? ` (planned ${item.plannedDate})` : ""}
          </span>
          <span className="mt-1 block text-xs font-medium text-burgundy"><T>Review →</T></span>
        </Link>
      )}
    />
  );
}
