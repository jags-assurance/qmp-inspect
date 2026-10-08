import Link from "next/link";
import { T } from "@/components/domain/t";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart, bucketAge } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "../ncrs/ncrs-table";
import { NcrPanel } from "../ncrs/ncr-panel";
import { NCR_TABLE_PAGE_SIZE } from "../ncrs/constants";
import { DisciplineFilterForm } from "../ncrs/discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { RaiseObservationPanel } from "./raise-observation-panel";

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

  // Stat cards use head+count queries (no rows transferred); only the open rows' created_at is
  // fetched for the aging chart. The table itself is a paginated + searched query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ncrs is an untyped table handle
  const baseFilters = (q: any): any => {
    let out = q;
    if (itpItemIdFilter) {
      out = itpItemIdFilter.length === 0 ? out.eq("id", "00000000-0000-0000-0000-000000000000") : out.in("itp_item_id", itpItemIdFilter);
    }
    if (projectId) out = out.eq("project_id", projectId);
    return out;
  };
  const countQuery = () => baseFilters(supabase.from(NCRS_TABLE).select("id", { count: "exact", head: true }).eq("severity", "observation"));
  const todayIso = new Date().toISOString().slice(0, 10);
  let tableQuery = baseFilters(
    supabase
      .from(NCRS_TABLE)
      .select("id, ncr_number, severity, description, status, due_date, created_at, projects(name, project_number)", {
        count: "exact",
      })
      .eq("severity", "observation")
  );
  if (q) {
    // Strip PostgREST filter metacharacters so a search term can't inject extra filter clauses.
    const safeQ = q.replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
    if (safeQ) tableQuery = tableQuery.or(`ncr_number.ilike.%${safeQ}%,description.ilike.%${safeQ}%`);
  }

  const offset = (page - 1) * NCR_TABLE_PAGE_SIZE;
  const [totalRes, openRes, closedRes, overdueRes, openAgesRes, { data: observations, count: totalCount }] = await Promise.all([
    countQuery(),
    countQuery().neq("status", "closed"),
    countQuery().eq("status", "closed"),
    countQuery().neq("status", "closed").lt("due_date", todayIso),
    baseFilters(supabase.from(NCRS_TABLE).select("created_at").eq("severity", "observation")).neq("status", "closed").limit(2000),
    tableQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + NCR_TABLE_PAGE_SIZE - 1)
      ,
  ]);

  const rows = (observations ?? []) as NcrRegisterRow[];
  const total = totalRes.count ?? 0;
  const open = openRes.count ?? 0;
  const closed = closedRes.count ?? 0;
  const overdue = overdueRes.count ?? 0;
  const today = new Date().getTime();
  const openAgeDays = (openAgesRes.data ?? []).map((r: { created_at: string }) => Math.floor((today - new Date(r.created_at).getTime()) / 86_400_000));
  const agingCounts = bucketAge(openAgeDays);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink"><T>Observation Register</T></h1>
            <PageGuide
              title="Observation Register — how this works"
              points={[
                "Observations are raised on the same NCR form and stored in the same ncrs table as minor/major NCRs — severity \"Observation\" is what routes a record here instead of to the NCR Register, so the two registers never double-list the same rows.",
                "Anyone with project access can raise one via \"+ Raise Observation\". An observation does not create a punch-list item and does not count in readiness or the open-NCR exceptions; if JAGS staff grade it up to a minor or major NCR, a punch-list item is created then.",
                "Closing one follows the same flow as an NCR: root cause, corrective and preventive action, verification notes and evidence, then Send for verification; a JAGS admin (or close NCR permission holder) who did not raise it verifies and closes it.",
                "The discipline filter only matches observations raised against a specific ITP item — a standalone one has no discipline and stays visible unfiltered.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Observations across every project you have access to."
              : "Observations on your organisation's projects."}{" "}
            <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
              See NCRs →
            </Link>
          </p>
        </div>
        <RaiseObservationPanel />
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
          gradeAction={session.isJagsStaff}
          idColumnHeader="Observation No."
          searchPlaceholder="Search observations…"
          emptyMessage="No observations raised yet."
        />
      </div>
      <NcrPanel />
    </div>
  );
}
