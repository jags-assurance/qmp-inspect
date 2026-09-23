import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart, bucketAge } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "./ncrs-table";
import { NCR_TABLE_PAGE_SIZE } from "./constants";
import { isOverdue } from "./is-overdue";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { DisciplineFilterForm } from "./discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";

export default async function NcrsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string; q?: string; page?: string }>;
}) {
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId, q, page: pageParam } = await searchParams;
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
  if (projectId) {
    statsQuery = statsQuery.eq("project_id", projectId);
    countQuery = countQuery.eq("project_id", projectId);
    tableQuery = tableQuery.eq("project_id", projectId);
  }
  if (q) {
    countQuery = countQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
    tableQuery = tableQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const offset = (page - 1) * NCR_TABLE_PAGE_SIZE;
  const [{ data: statsRows }, { count: totalCount }, { data: ncrs }] = await Promise.all([
    statsQuery.returns<Pick<NcrRegisterRow, "status" | "due_date" | "created_at">[]>(),
    countQuery,
    tableQuery
      .order("created_at", { ascending: false })
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

  return (
    <div>
      <RealtimeRefresh table="ncrs" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">NCR Register</h1>
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
        <NcrsTable rows={rows} totalCount={totalCount ?? 0} />
      </div>
    </div>
  );
}
