import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart, bucketAge } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "../ncrs/ncrs-table";
import { NCR_TABLE_PAGE_SIZE } from "../ncrs/constants";
import { isOverdue } from "../ncrs/is-overdue";
import { DisciplineFilterForm } from "../ncrs/discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";

/**
 * A separate register for observations (R84: "provide live NCR and Observation registers" —
 * plural), reusing the same underlying engine as the NCR register (R82: one engine, graded by
 * severity) rather than a different table. Previously observations only ever showed up folded
 * into the combined NCR table with no register of their own; this splits them out, matching the
 * reference UI (group-5-2-ncr-observation-registers.png shows two separate registers side by
 * side) while /inspect/ncrs now excludes observations to avoid double-listing the same rows.
 */
export default async function ObservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string; q?: string; page?: string }>;
}) {
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId, q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  const disciplines = await getActiveMasterDisciplines();

  // Same shape as apps/web/app/inspect/ncrs/page.tsx: observations reuse the ncrs table (graded
  // by severity), so they reach a discipline the same indirect way — via the optional itp_item_id
  // link to itp_items.discipline_id.
  let itpItemIdFilter: string[] | null = null;
  if (disciplineId) {
    const { data: taggedItems } = await supabase
      .from("itp_items")
      .select("id")
      .eq("discipline_id", disciplineId)
      .returns<{ id: string }[]>();

    itpItemIdFilter = (taggedItems ?? []).map((i) => i.id);
  }

  // Same split as apps/web/app/inspect/ncrs/page.tsx: a light, unpaginated query for stat-card/
  // aging-chart totals, and a real server-side-paginated + searched query for the table itself.
  let statsQuery = supabase.from(NCRS_TABLE).select("status, due_date, created_at").eq("severity", "observation");
  let tableQuery = supabase
    .from(NCRS_TABLE)
    .select("id, ncr_number, severity, description, status, due_date, created_at, projects(name, project_number)", {
      count: "exact",
    })
    .eq("severity", "observation");

  if (itpItemIdFilter) {
    const noMatch = itpItemIdFilter.length === 0;
    statsQuery = noMatch ? statsQuery.eq("id", "00000000-0000-0000-0000-000000000000") : statsQuery.in("itp_item_id", itpItemIdFilter);
    tableQuery = noMatch ? tableQuery.eq("id", "00000000-0000-0000-0000-000000000000") : tableQuery.in("itp_item_id", itpItemIdFilter);
  }
  if (projectId) {
    statsQuery = statsQuery.eq("project_id", projectId);
    tableQuery = tableQuery.eq("project_id", projectId);
  }
  if (q) {
    tableQuery = tableQuery.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const offset = (page - 1) * NCR_TABLE_PAGE_SIZE;
  const [{ data: statsRows }, { data: observations, count: totalCount }] = await Promise.all([
    statsQuery.returns<Pick<NcrRegisterRow, "status" | "due_date" | "created_at">[]>(),
    tableQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + NCR_TABLE_PAGE_SIZE - 1)
      .returns<NcrRegisterRow[]>(),
  ]);

  const rows = observations ?? [];
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Observation Register</h1>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Observations across every project you have access to."
              : "Observations on your organisation's projects."}{" "}
            <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
              See NCRs →
            </Link>
          </p>
        </div>
        <Link href="/inspect/ncrs/new">
          <Button>+ Raise Observation</Button>
        </Link>
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/observations" className="text-burgundy hover:underline">
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
        <NcrsTable
          rows={rows}
          totalCount={totalCount ?? 0}
          idColumnHeader="Observation No."
          searchPlaceholder="Search observations…"
          emptyMessage="No observations raised yet."
        />
      </div>
    </div>
  );
}
