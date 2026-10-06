import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart, bucketAge } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "./ncrs-table";
import { NcrPanel } from "./ncr-panel";
import { NCR_TABLE_PAGE_SIZE } from "./constants";
import { isOverdue } from "./is-overdue";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { DisciplineFilterForm } from "./discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { applyNcrFilters, applyNcrSort, SORT_OPTIONS, type NcrListParams } from "@/lib/ncrs/list-filters";
import { STATUS_LABEL } from "./ncr-shared";

export default async function NcrsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; page?: string } & NcrListParams>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
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
  let statsQuery = supabase
    .from(NCRS_TABLE)
    .select("status, due_date, created_at")
    .neq("severity", "observation");
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
      "id, ncr_number, severity, description, status, due_date, created_at, projects(name, project_number), itp_items(master_disciplines(code, name))"
    )
    .neq("severity", "observation");

  if (itpItemIdFilter) {
    const noMatch = itpItemIdFilter.length === 0;
    statsQuery = noMatch ? statsQuery.eq("id", "00000000-0000-0000-0000-000000000000") : statsQuery.in("itp_item_id", itpItemIdFilter);
    countQuery = noMatch ? countQuery.eq("id", "00000000-0000-0000-0000-000000000000") : countQuery.in("itp_item_id", itpItemIdFilter);
    tableQuery = noMatch ? tableQuery.eq("id", "00000000-0000-0000-0000-000000000000") : tableQuery.in("itp_item_id", itpItemIdFilter);
  }
  // Status chips/counts ignore the status and overdue filters so every chip keeps showing its total.
  statsQuery = applyNcrFilters(statsQuery, { ...sp, status: undefined, overdue: undefined }, session.userId);
  countQuery = applyNcrFilters(countQuery, sp, session.userId);
  tableQuery = applyNcrFilters(tableQuery, sp, session.userId);
  if (q) {
    countQuery = countQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
    tableQuery = tableQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const offset = (page - 1) * NCR_TABLE_PAGE_SIZE;
  const [{ data: statsRows }, { count: totalCount }, { data: ncrs }] = await Promise.all([
    statsQuery.returns<Pick<NcrRegisterRow, "status" | "due_date" | "created_at">[]>(),
    countQuery,
    (applyNcrSort(tableQuery, sp.sort) as typeof tableQuery)
      .range(offset, offset + NCR_TABLE_PAGE_SIZE - 1)
      .returns<NcrRegisterRow[]>(),
  ]);

  const rows = ncrs ?? [];
  const statRows = statsRows ?? [];
  const total = statRows.length;
  const open = statRows.filter((r) => r.status !== "closed").length;
  const closed = statRows.filter((r) => r.status === "closed").length;
  const overdue = statRows.filter(isOverdue).length;
  const today = new Date().getTime();
  const openAgeDays = statRows
    .filter((r) => r.status !== "closed")
    .map((r) => Math.floor((today - new Date(r.created_at).getTime()) / 86_400_000));
  const agingCounts = bucketAge(openAgeDays);
  const statusCounts: Record<string, number> = {};
  for (const r of statRows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  const hrefWith = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch, page: undefined })) if (v) next.set(k, String(v));
    const qs = next.toString();
    return qs ? `/inspect/ncrs?${qs}` : "/inspect/ncrs";
  };
  const exportQs = new URLSearchParams();
  for (const k of ["status", "severity", "project", "assignee", "overdue", "sort", "q"] as const) if (sp[k]) exportQs.set(k, sp[k]!);
  const filtersActive = Boolean(sp.status || sp.severity || sp.assignee || sp.overdue || q || projectId || disciplineId);
  const chip = (active: boolean) =>
    "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium " +
    (active ? "border-burgundy bg-burgundy text-white" : "border-border bg-surface text-ink hover:bg-off-white");

  return (
    <div>
      <RealtimeRefresh table="ncrs" />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">NCR Register</h1>
            <PageGuide
              title="NCR Register — how this works"
              points={[
                "Lists every minor/major NCR (observations are excluded — they have their own register) with server-side search, pagination and a discipline filter.",
                "Anyone with project access can raise an NCR via \"+ Raise NCR\" — raising one always also creates a matching project punch-list item, since every NCR must be closed out before handover regardless of severity.",
                "Closing an NCR requires root cause, corrective action and verification notes to be filled in (preventive action is optional) — enforced by the close-out action, not just the form. There's no separate reviewer/approver step: anyone with project access who fills those fields in can close it.",
                "The discipline filter only matches NCRs raised against a specific ITP item — a standalone/walkdown NCR has no discipline of its own and always stays visible unfiltered.",
                "Stat cards and the aging chart are computed from every matching NCR, not just the current page.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Minor and major non-conformances across every project you have access to."
              : "Minor and major non-conformances on your organisation's projects."}{" "}
            <Link href="/inspect/observations" className="text-burgundy hover:underline">
              See observations →
            </Link>
          </p>
        </div>
        <Link href="/inspect/ncrs/new">
          <Button>+ Raise NCR</Button>
        </Link>
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
            Clear filter
          </Link>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter by status">
        <Link href={hrefWith({ status: undefined, overdue: undefined })} className={chip(!sp.status && !sp.overdue)}>
          All ({total})
        </Link>
        <Link href={hrefWith({ status: "active", overdue: undefined })} className={chip(sp.status === "active")}>
          Active ({open})
        </Link>
        {(["open", "in_progress", "pending_verification", "closed"] as const).map((st) => (
          <Link key={st} href={hrefWith({ status: st, overdue: undefined })} className={chip(sp.status === st)}>
            {STATUS_LABEL[st]} ({statusCounts[st] ?? 0})
          </Link>
        ))}
        <Link href={hrefWith({ overdue: "1", status: undefined })} className={chip(sp.overdue === "1")}>
          Overdue ({overdue})
        </Link>
      </div>

      <form method="get" action="/inspect/ncrs" className="mt-3 flex flex-wrap items-end gap-3">
        {projectId && <input type="hidden" name="project" value={projectId} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {sp.overdue && <input type="hidden" name="overdue" value={sp.overdue} />}
        <label className="text-xs text-muted">
          Severity
          <select name="severity" defaultValue={sp.severity ?? ""} className="mt-1 block min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            <option value="">Any</option>
            <option value="major_ncr">Major NCR</option>
            <option value="minor_ncr">Minor NCR</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Assignee
          <select name="assignee" defaultValue={sp.assignee ?? ""} className="mt-1 block min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          Sort
          <select name="sort" defaultValue={sp.sort ?? "newest"} className="mt-1 block min-h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {filtersActive && (
          <Link href="/inspect/ncrs" className="min-h-9 py-2 text-sm text-burgundy hover:underline">
            Clear all
          </Link>
        )}
        <a href={`/inspect/ncrs/export${exportQs.toString() ? `?${exportQs}` : ""}`} className="ml-auto min-h-9 py-2 text-sm text-burgundy hover:underline">
          Export CSV
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

      <div className="mt-6">
        <NcrsTable
          rows={rows}
          totalCount={totalCount ?? 0}
          emptyMessage={filtersActive ? "No NCRs match these filters. Clear the filters to see the full register." : "No NCRs raised yet. Use + Raise NCR to record the first one."}
        />
      </div>
      <NcrPanel />
    </div>
  );
}
