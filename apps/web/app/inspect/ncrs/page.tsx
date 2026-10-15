import Link from "next/link";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { loadRegisterStats } from "@/lib/ncrs/register-stats-loader";
import { registerStatsFromRows } from "@/lib/ncrs/register-stats";
import { resolveSiteTimeZone, siteToday } from "@/lib/ncrs/site-date";
import { fetchProjectTimeZone, fetchProjectTimeZones } from "@/lib/projects/timezone";
import { T } from "@/components/domain/t";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StatusLegend } from "@/components/ui/status-legend";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "./ncrs-table";
import { NcrPanel } from "./ncr-panel";
import { NCR_TABLE_PAGE_SIZE } from "./constants";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { DisciplineFilterForm } from "./discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { applyNcrFilters, applyNcrSort, SORT_OPTIONS, type NcrListParams } from "@/lib/ncrs/list-filters";
import { STATUS_LABEL } from "./ncr-shared";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";

export default async function NcrsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; page?: string } & NcrListParams>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const sp = withActiveProject(await searchParams, await getActiveProjectId());
  const { discipline: disciplineId, project: projectId, page: pageParam } = sp;
  // Strip characters that would break the PostgREST or() filter.
  const q = sp.q?.replace(/[%,()]/g, " ").trim() || undefined;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  const disciplines = await getActiveMasterDisciplines();

  // NCRs don't carry a discipline_id column of their own — they only reach one through the
  // (optional, nullable) itp_item_id link to itp_items.discipline_id. So the filter is applied as
  // an id allowlist, same shape as apps/web/app/inspect/itps/page.tsx: resolve the matching
  // itp_item ids first, then .in() the NCR query by those. An NCR raised standalone (no
  // itp_item_id) simply never matches a discipline filter — it's still shown in the unfiltered
  // register, never excluded from that.
  let itpItemIdFilter: string[] | null = null;
  if (disciplineId) {
    const { data: taggedItems } = await supabase
      .from("itp_items")
      .select("id")
      .eq("discipline_id", disciplineId)
      .returns<{ id: string }[]>();

    itpItemIdFilter = (taggedItems ?? []).map((i) => i.id);
  }

  // Round-table performance finding: this used to fetch every matching NCR's full row (with two
  // joins) just to compute stat-card totals and feed the table, which then filtered/paginated all
  // of it client-side. Split into two queries: a light one (few columns, no joins) for the stat
  // cards/aging chart — still fetches every matching row, but the aggregate numbers genuinely need
  // every row to be correct without a real SQL GROUP BY, and this is far cheaper than the full
  // joined row — and a second, real server-side-paginated + searched query that only ever returns
  // one page's worth of the full joined rows for the table itself.
  // A dedicated head:true count query — kept entirely separate from the data query below (no
  // embeds, no range) rather than using `.select(cols, {count:'exact'})` combined with `.range()`,
  // which was observed to return an accurate count but a silently empty data array specifically
  // when combined with embedded-resource joins under this app's Next.js server client. Isolating
  // the count into its own minimal-shape query sidesteps that entirely.
  let countQuery = supabase
    .from(NCRS_TABLE)
    .select("id", { count: "exact", head: true })
    .neq("severity", "observation");
  let tableQuery = supabase
    .from(NCRS_TABLE)
    .select(
      "id, ncr_number, severity, description, status, due_date, created_at, project_id, projects(name, project_number), itp_items(master_disciplines(code, name))"
    )
    .neq("severity", "observation");

  if (itpItemIdFilter) {
    const noMatch = itpItemIdFilter.length === 0;
    countQuery = noMatch ? countQuery.eq("id", "00000000-0000-0000-0000-000000000000") : countQuery.in("itp_item_id", itpItemIdFilter);
    tableQuery = noMatch ? tableQuery.eq("id", "00000000-0000-0000-0000-000000000000") : tableQuery.in("itp_item_id", itpItemIdFilter);
  }
  // Status chips/counts ignore the status and overdue filters so every chip keeps showing its total.
  // ONE light query (status, due date, created date only) feeds every stat card, chip count and the aging
  // chart, computed here. That is one database round trip, not a dozen counts that would each re-run the
  // row-level security checks over the whole table on every page view.
  let statsQuery = supabase.from(NCRS_TABLE).select("status, due_date, created_at").neq("severity", "observation");
  if (itpItemIdFilter) {
    statsQuery = itpItemIdFilter.length === 0 ? statsQuery.eq("id", "00000000-0000-0000-0000-000000000000") : statsQuery.in("itp_item_id", itpItemIdFilter);
  }
  // A single-project view judges overdue on that project's site day; the cross-project register uses the env site zone.
  const filterTz = projectId ? await fetchProjectTimeZone(supabase, projectId) : null;
  statsQuery = applyNcrFilters(statsQuery, { ...sp, status: undefined, overdue: undefined }, session.userId, filterTz);
  const STATUSES = ["open", "in_progress", "pending_verification", "closed"] as const;
  countQuery = applyNcrFilters(countQuery, sp, session.userId, filterTz);
  tableQuery = applyNcrFilters(tableQuery, sp, session.userId, filterTz);
  if (q) {
    countQuery = countQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
    tableQuery = tableQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const offset = (page - 1) * NCR_TABLE_PAGE_SIZE;
  // Stat cards, chip counts and the aging chart come from one SQL aggregate (falls back to paging the
  // light rows until the register_stats migration is applied).
  // Server component: evaluated once per request, which is the intended "now".
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const fetchStatRows = () =>
    fetchAll<Pick<NcrRegisterRow, "status" | "due_date" | "created_at">>((from, to) =>
      statsQuery.order("id").range(from, to).returns<Pick<NcrRegisterRow, "status" | "due_date" | "created_at">[]>()
    );
  // Staff only: open NCRs (not observations) that nobody owns, so they can be assigned.
  const unownedCountPromise = session.isJagsStaff
    ? supabase
        .from(NCRS_TABLE)
        .select("id", { count: "exact", head: true })
        .neq("severity", "observation")
        .neq("status", "closed")
        .is("assigned_to", null)
        .is("responsible_party_id", null)
    : Promise.resolve({ count: 0 });
  const unownedObservationsPromise = session.isJagsStaff
    ? supabase
        .from(NCRS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("severity", "observation")
        .neq("status", "closed")
        .is("assigned_to", null)
        .is("responsible_party_id", null)
    : Promise.resolve({ count: 0 });
  const [stats, { count: totalCount }, { data: ncrs }, { count: unownedCount }, { count: unownedObservationCount }] = await Promise.all([
    // The owner filter is not understood by the SQL aggregate, so a filtered view counts from its own rows.
    sp.owner === "none"
      ? fetchStatRows().then((r) => registerStatsFromRows(r, nowMs, siteToday(new Date(), resolveSiteTimeZone(filterTz))))
      : loadRegisterStats(
      supabase,
      {
        observations: false,
        projectId: sp.project,
        severity: sp.severity,
        assignee: sp.assignee,
        userId: session.userId,
        itpItemIds: itpItemIdFilter,
        todayIso: siteToday(new Date(), resolveSiteTimeZone(filterTz)),
        nowMs,
      },
      fetchStatRows
    ),
    countQuery,
    (applyNcrSort(tableQuery, sp.sort) as typeof tableQuery)
      .range(offset, offset + NCR_TABLE_PAGE_SIZE - 1)
      .returns<NcrRegisterRow[]>(),
    unownedCountPromise,
    unownedObservationsPromise,
  ]);

  const rows = ncrs ?? [];
  const rowTimeZones = Object.fromEntries(await fetchProjectTimeZones(supabase, rows.map((r) => r.project_id ?? "")));
  const { total, open, closed, overdue, statusCounts } = stats;
  const agingCounts = stats.aging;
  const hrefWith = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch, page: undefined })) if (v) next.set(k, String(v));
    const qs = next.toString();
    return qs ? `/inspect/ncrs?${qs}` : "/inspect/ncrs";
  };
  const exportQs = new URLSearchParams();
  for (const k of ["status", "severity", "project", "assignee", "owner", "overdue", "sort", "q"] as const) if (sp[k]) exportQs.set(k, sp[k]!);
  const filtersActive = Boolean(sp.status || sp.severity || sp.assignee || sp.owner || sp.overdue || q || projectId || disciplineId);
  const chip = (active: boolean) =>
    "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium " +
    (active ? "border-burgundy bg-burgundy text-white" : "border-border bg-surface text-ink hover:bg-off-white");

  return (
    <div>
      <RealtimeRefresh table="ncrs" />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink"><T>NCR Register</T></h1>
            <PageGuide
              title={tl("NCR Register — how this works")}
              points={[
                "Lists every minor/major NCR (observations are excluded — they have their own register) with server-side search, pagination and a discipline filter.",
                "Anyone with project access can raise an NCR via \"+ Raise NCR\" — raising one always also creates a matching project punch-list item, since every NCR must be closed out before handover regardless of severity.",
                "Sending an NCR for verification needs root cause, corrective and preventive action and at least one evidence photo or document. Closing additionally needs verification notes, and is done by a JAGS admin or someone granted the close NCR permission - not the raiser or the assignee. Raised in error? Withdraw it (with a reason) instead of working it to closure.",
                "The discipline filter only matches NCRs raised against a specific ITP item — a standalone/walkdown NCR has no discipline of its own and always stays visible unfiltered.",
                "Stat cards and the aging chart are computed from every matching NCR, not just the current page. \"Overdue\" uses the site's calendar day.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            <Link href="/inspect/observations" className="text-burgundy hover:underline">
              <T>See observations →</T>
            </Link>
            {session.isJagsStaff && (
              <>
                {" "}
                <Link href="/inspect/ncrs/scorecard" className="text-burgundy hover:underline">
                  <T>Vendor scorecard →</T>
                </Link>
              </>
            )}
          </p>
        </div>
        <Link href="/inspect/ncrs/new">
          <Button><T>+ Raise NCR</T></Button>
        </Link>
      </div>

      {session.isJagsStaff && (unownedCount ?? 0) > 0 && (
        <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink">
          <T>NCRs without an owner:</T> <strong>{unownedCount}</strong>{" "}
          <Link href={hrefWith({ owner: "none", status: undefined, overdue: undefined, assignee: undefined })} className="text-burgundy hover:underline">
            <T>Show them so they can be assigned</T>
          </Link>
        </p>
      )}

      {session.isJagsStaff && (unownedObservationCount ?? 0) > 0 && (
        <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink">
          <T>Observations without an owner:</T> <strong>{unownedObservationCount}</strong>{" "}
          <Link href={projectId ? `/inspect/observations?owner=none&project=${projectId}` : "/inspect/observations?owner=none"} className="text-burgundy hover:underline">
            <T>Show them so they can be assigned</T>
          </Link>
        </p>
      )}

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          <T>Filtered to one project.</T>{" "}
          <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
            <T>Clear filter</T>
          </Link>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2" aria-label={tl("Filter by status")}>
        <Link href={hrefWith({ status: undefined, overdue: undefined })} className={chip(!sp.status && !sp.overdue)}>
          <T>All (</T>{total})
        </Link>
        <Link href={hrefWith({ status: "active", overdue: undefined })} className={chip(sp.status === "active")}>
          <T>Active (</T>{open})
        </Link>
        {(["open", "in_progress", "pending_verification", "closed"] as const).map((st) => (
          <Link key={st} href={hrefWith({ status: st, overdue: undefined })} className={chip(sp.status === st)}>
            {STATUS_LABEL[st]} ({statusCounts[st] ?? 0})
          </Link>
        ))}
        <Link href={hrefWith({ overdue: "1", status: undefined })} className={chip(sp.overdue === "1")}>
          <T>Overdue (</T>{overdue})
        </Link>
      </div>

      <form method="get" action="/inspect/ncrs" className="mt-3 flex flex-wrap items-end gap-3">
        {projectId && <input type="hidden" name="project" value={projectId} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {sp.overdue && <input type="hidden" name="overdue" value={sp.overdue} />}
        {sp.owner && <input type="hidden" name="owner" value={sp.owner} />}
        <label className="text-xs text-muted">
          <T>Severity</T>
          <select name="severity" defaultValue={sp.severity ?? ""} className="mt-1 block min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            <option value=""><T>Any</T></option>
            <option value="major_ncr"><T>Major NCR</T></option>
            <option value="minor_ncr"><T>Minor NCR</T></option>
          </select>
        </label>
        <label className="text-xs text-muted">
          <T>Assignee</T>
          <select name="assignee" defaultValue={sp.assignee ?? ""} className="mt-1 block min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            <option value=""><T>Anyone</T></option>
            <option value="me"><T>Assigned to me</T></option>
            <option value="unassigned"><T>Unassigned</T></option>
          </select>
        </label>
        <label className="text-xs text-muted">
          <T>Sort</T>
          <select name="sort" defaultValue={sp.sort ?? "newest"} className="mt-1 block min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          <T>Apply</T>
        </Button>
        {filtersActive && (
          <Link href="/inspect/ncrs" className="min-h-9 py-2 text-sm text-burgundy hover:underline">
            <T>Clear all</T>
          </Link>
        )}
        <a href={`/inspect/ncrs/export${exportQs.toString() ? `?${exportQs}` : ""}`} className="ms-auto min-h-9 py-2 text-sm text-burgundy hover:underline">
          <T>Export CSV</T>
        </a>
      </form>

      <div className="mt-6">
        <DisciplineFilterForm disciplines={disciplines ?? []} selectedDisciplineId={disciplineId ?? null} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={total} />
        <StatCard label="Open" value={open} />
        <StatCard label="Overdue" value={overdue} />
        <StatCard label="Closed" value={closed} />
      </div>

      <div className="mt-6">
        <AgingChart counts={agingCounts} />
      </div>

      <StatusLegend className="mt-6" />
      <div className="mt-2">
        <NcrsTable
          rows={rows}
          timeZones={rowTimeZones}
          totalCount={totalCount ?? 0}
          emptyMessage={filtersActive ? "No NCRs match these filters. Clear the filters to see the full register." : "No NCRs raised yet. Use + Raise NCR to record the first one."}
        />
      </div>
      <NcrPanel />
    </div>
  );
}
