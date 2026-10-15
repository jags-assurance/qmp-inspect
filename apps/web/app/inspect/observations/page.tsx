import Link from "next/link";
import { T } from "@/components/domain/t";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "../ncrs/ncrs-table";
import { NcrPanel } from "../ncrs/ncr-panel";
import { NCR_TABLE_PAGE_SIZE } from "../ncrs/constants";
import { DisciplineFilterForm } from "../ncrs/discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { RaiseObservationPanel } from "./raise-observation-panel";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { loadRegisterStats } from "@/lib/ncrs/register-stats-loader";
import { registerStatsFromRows, type ObservationStatRow } from "@/lib/ncrs/register-stats";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";

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
  searchParams: Promise<{ discipline?: string; project?: string; q?: string; page?: string; owner?: string }>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId, q, page: pageParam, owner } = withActiveProject(await searchParams, await getActiveProjectId());
  const ownerNone = owner === "none";
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

  // ONE light query (status, due date, created date) feeds every stat card and the aging chart — it used
  // to be four head counts plus a separate open-ages query, each re-running the ncrs row-level security
  // over the whole table. The table itself is a paginated + searched query (with its own exact count).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ncrs is an untyped table handle
  const baseFilters = (q: any): any => {
    let out = q;
    if (itpItemIdFilter) {
      out = itpItemIdFilter.length === 0 ? out.eq("id", "00000000-0000-0000-0000-000000000000") : out.in("itp_item_id", itpItemIdFilter);
    }
    if (projectId) out = out.eq("project_id", projectId);
    if (ownerNone) out = out.is("assigned_to", null).is("responsible_party_id", null);
    return out;
  };
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
  const nowMs = new Date().getTime();
  const [stats, { data: observations, count: totalCount, error: observationsError }] = await Promise.all([
    ownerNone
      ? fetchAll<ObservationStatRow>((from, to) =>
          baseFilters(supabase.from(NCRS_TABLE).select("status, due_date, created_at").eq("severity", "observation"))
            .order("id")
            .range(from, to)
        ).then((r) => registerStatsFromRows(r, nowMs, todayIso))
      : loadRegisterStats(
      supabase,
      { observations: true, projectId, itpItemIds: itpItemIdFilter, todayIso, nowMs },
      () =>
        fetchAll<ObservationStatRow>((from, to) =>
          baseFilters(supabase.from(NCRS_TABLE).select("status, due_date, created_at").eq("severity", "observation"))
            .order("id")
            .range(from, to)
        )
    ),
    tableQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + NCR_TABLE_PAGE_SIZE - 1)
      ,
  ]);

  // A failed read showed "No observations raised yet." under cards that counted 11 (seen on dev).
  if (observationsError) throw new Error(`Could not load the observation register: ${observationsError.message}`);
  const rows = (observations ?? []) as NcrRegisterRow[];
  const { total, open, closed, overdue } = stats;
  const agingCounts = stats.aging;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink"><T>Observation Register</T></h1>
            <PageGuide
              title={tl("Observation Register — how this works")}
              points={[
                "Observations are raised on the same NCR form and stored in the same ncrs table as minor/major NCRs — severity \"Observation\" is what routes a record here instead of to the NCR Register, so the two registers never double-list the same rows.",
                "Anyone with project access can raise one via \"+ Raise Observation\". An observation does not create a punch-list item and does not count in readiness or the open-NCR exceptions; if JAGS staff grade it up to a minor or major NCR, a punch-list item is created then.",
                "Closing one follows the same flow as an NCR: root cause, corrective and preventive action, verification notes and evidence, then Send for verification; a JAGS admin (or close NCR permission holder) who did not raise it verifies and closes it.",
                "The discipline filter only matches observations raised against a specific ITP item — a standalone one has no discipline and stays visible unfiltered.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
              <T>See NCRs →</T>
            </Link>
          </p>
        </div>
        <RaiseObservationPanel />
      </div>

      {ownerNone && (
        <p className="mt-3 text-sm text-muted">
          <T>Showing observations without an owner.</T>{" "}
          <Link href={projectId ? `/inspect/observations?project=${projectId}` : "/inspect/observations"} className="text-burgundy hover:underline">
            <T>Clear filter</T>
          </Link>
        </p>
      )}

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          <T>Filtered to one project.</T>{" "}
          <Link href="/inspect/observations" className="text-burgundy hover:underline">
            <T>Clear filter</T>
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
