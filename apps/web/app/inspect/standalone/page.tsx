import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar, FilterField } from "@/components/ui/toolbar";
import { FilterChips } from "@/components/ui/filter-chips";
import { FILTER_CONTROL_CLASS } from "@/components/ui/filter-styles";
import { StandaloneTable, type StandaloneAssignmentListRow } from "./standalone-table";
import { STANDALONE_TABLE_PAGE_SIZE } from "./constants";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";

export const maxDuration = 300;

export default async function StandaloneAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; q?: string; page?: string; status?: string; type?: string; result?: string; sort?: string }>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  // Full Client-Managed tier: a run_standalone_assignment permission holder gets the same
  // "+ New assignment" affordance JAGS staff always had — org-wide check since we don't yet know
  // which project they'll pick; a project-scoped grant just won't show the button here (they'd
  // still succeed from a project-filtered view, this is only about this one link's visibility).
  // Tier-independent: a subcontractor/main_contractor also gets it if at least one of their active
  // projects has opted into allow_contractor_standalone_assignment.
  let canRunStandaloneAssignment = session.isJagsStaff || (await hasPermission(session.userId, "run_standalone_assignment"));
  if (!canRunStandaloneAssignment) {
    const { count } = await supabase
      .from("project_parties")
      .select("id, projects!inner(allow_contractor_standalone_assignment)", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .eq("is_active", true)
      .in("party_type", ["subcontractor", "main_contractor"])
      .eq("projects.allow_contractor_standalone_assignment", true);
    canRunStandaloneAssignment = !!count;
  }
  const sp = withActiveProject(await searchParams, await getActiveProjectId());
  const { project: projectId, discipline: disciplineId, page: pageParam } = sp;
  // PostgREST .or() treats , ( ) as syntax and % _ as wildcards - strip them from user text.
  const q = (sp.q ?? "").replace(/[,()%_\\*]/g, " ").trim().slice(0, 80);
  const statusFilter = ["draft", "conditional_open", "completed"].includes(sp.status ?? "") ? sp.status! : "";
  const typeFilter = ["fat", "witness_inspection", "specific_test", "pre_shipment"].includes(sp.type ?? "") ? sp.type! : "";
  const resultFilter = ["pass", "conditional_pass", "fail"].includes(sp.result ?? "") ? sp.result! : "";
  const sortKey = ["newest", "oldest", "date", "number"].includes(sp.sort ?? "") ? sp.sort! : "newest";
  const page = Math.max(1, Number(pageParam ?? "1") || 1);

  const disciplines = await getActiveMasterDisciplines();

  // Round-table performance finding (same pattern as apps/web/app/inspect/ncrs/page.tsx): this
  // register used to fetch every matching assignment at once and filter/paginate it client-side.
  // Split into a dedicated head:true count query (no embeds/joins/range) and a real server-side-
  // paginated + searched data query, kept separate rather than combining `{count:'exact'}` with
  // `.range()` on the same query — that combination was observed elsewhere in this app to return
  // an accurate count alongside a silently empty data array once embedded-resource joins were
  // involved. This register has no stat cards, so there's no need for a third "light stats" query.
  let countQuery = untypedFrom(supabase, "standalone_assignments").select("id", { count: "exact", head: true });
  let tableQuery = untypedFrom(supabase, "standalone_assignments")
    .select(
      "id, assignment_number, assignment_type, equipment_description, assignment_date, status, conclusion, discipline_id, projects(name), master_disciplines(code, name)"
    );

  if (projectId) {
    countQuery = countQuery.eq("project_id", projectId);
    tableQuery = tableQuery.eq("project_id", projectId);
  }
  if (disciplineId) {
    countQuery = countQuery.eq("discipline_id", disciplineId);
    tableQuery = tableQuery.eq("discipline_id", disciplineId);
  }
  if (statusFilter) {
    countQuery = countQuery.eq("status", statusFilter);
    tableQuery = tableQuery.eq("status", statusFilter);
  }
  if (typeFilter) {
    countQuery = countQuery.eq("assignment_type", typeFilter);
    tableQuery = tableQuery.eq("assignment_type", typeFilter);
  }
  if (resultFilter) {
    countQuery = countQuery.eq("conclusion", resultFilter);
    tableQuery = tableQuery.eq("conclusion", resultFilter);
  }
  if (q) {
    countQuery = countQuery.or(`assignment_number.ilike.%${q}%,equipment_description.ilike.%${q}%`);
    tableQuery = tableQuery.or(`assignment_number.ilike.%${q}%,equipment_description.ilike.%${q}%`);
  }

  const { data: projectOptions } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("name")
    .returns<{ id: string; project_number: string; name: string }[]>();
  const statusCounts = await Promise.all(
    ["draft", "conditional_open", "completed"].map(async (st) => {
      let c = untypedFrom(supabase, "standalone_assignments").select("id", { count: "exact", head: true }).eq("status", st);
      if (projectId) c = c.eq("project_id", projectId);
      const { count } = await c;
      return count ?? 0;
    })
  );
  const chipHref = (st: string) => {
    const u = new URLSearchParams();
    if (projectId) u.set("project", projectId);
    if (disciplineId) u.set("discipline", disciplineId);
    if (typeFilter) u.set("type", typeFilter);
    if (resultFilter) u.set("result", resultFilter);
    if (sortKey !== "newest") u.set("sort", sortKey);
    if (st) u.set("status", st);
    const qs = u.toString();
    return "/inspect/standalone" + (qs ? "?" + qs : "");
  };
  const chips: { val: string; label: string; n: number }[] = [
    { val: "", label: "All", n: statusCounts[0] + statusCounts[1] + statusCounts[2] },
    { val: "draft", label: "Draft", n: statusCounts[0] },
    { val: "conditional_open", label: "Awaiting clearance", n: statusCounts[1] },
    { val: "completed", label: "Completed", n: statusCounts[2] },
  ];
  const hasFilters = !!(projectId || disciplineId || q || statusFilter || typeFilter || resultFilter);
  const activeFilterCount = [projectId, disciplineId, typeFilter, resultFilter, sortKey !== "newest" ? sortKey : ""].filter(Boolean).length;

  const offset = (page - 1) * STANDALONE_TABLE_PAGE_SIZE;
  const [{ count: totalCount }, { data: assignments }] = await Promise.all([
    countQuery,
    (sortKey === "oldest"
      ? tableQuery.order("created_at", { ascending: true })
      : sortKey === "date"
        ? tableQuery.order("assignment_date", { ascending: false, nullsFirst: false })
        : sortKey === "number"
          ? tableQuery.order("assignment_number", { ascending: true })
          : tableQuery.order("created_at", { ascending: false })
    )
      .range(offset, offset + STANDALONE_TABLE_PAGE_SIZE - 1)
      .returns<StandaloneAssignmentListRow[]>(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0"
        title={<T>Standalone Assignments</T>}
        subtitle={<T>One-off FATs, witness inspections and tests, with no ITP needed.</T>}
        guide={
          <PageGuide
            title={tl("Standalone Assignments — how this works")}
            points={[
              "One-off FATs, witness inspections, specific tests and pre-shipment checks that don't need an ITP or data book behind them.",
              "Running one is JAGS-staff-only end to end — creating, adding measurements/photos/punch items/signatures, finalizing and issuing clearance — UNLESS your organisation is on the Full Client-Managed tier and you specifically hold the \"Create and run a Standalone Assignment\" custom permission, OR you're an active subcontractor/main-contractor party on a project a JAGS Admin has specifically opted into contractor-run assignments — either way you can then do all of it yourself.",
              "A conditional pass leaves the assignment genuinely open (\"conditional_open\") until its linked punch-list item(s) are closed and clearance is issued — a clean pass or fail completes immediately on finalize.",
              "The discipline filter and search run server-side against the full register, not just the current page.",
            ]}
          />
        }
        primaryAction={
          canRunStandaloneAssignment ? (
            <Link href="/inspect/standalone/new" className={buttonVariants()}>
              <T>+ New assignment</T>
            </Link>
          ) : undefined
        }
      />

      <FilterChips
        label={tl("Filter by status")}
        items={chips.map((c) => ({ key: c.val || "all", label: tl(c.label), count: c.n, href: chipHref(c.val), active: statusFilter === c.val }))}
      />

      <FilterBar
        activeCount={activeFilterCount}
        clearHref={hasFilters ? "/inspect/standalone?project=" : undefined}
        filters={
          <form method="get" className="flex w-full flex-col gap-4 md:w-auto md:flex-row md:flex-wrap md:items-end md:gap-3">
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            {q && <input type="hidden" name="q" value={q} />}
            <FilterField label={<T>Project</T>}>
              <select name="project" defaultValue={projectId ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>All projects</T></option>
                {(projectOptions ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.project_number} - {p.name}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={<T>Type</T>}>
              <select name="type" defaultValue={typeFilter} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>All types</T></option>
                <option value="fat"><T>FAT</T></option>
                <option value="witness_inspection"><T>Witness Inspection</T></option>
                <option value="specific_test"><T>Specific Test</T></option>
                <option value="pre_shipment"><T>Pre-Shipment</T></option>
              </select>
            </FilterField>
            <FilterField label={<T>Result</T>}>
              <select name="result" defaultValue={resultFilter} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>Any result</T></option>
                <option value="pass"><T>Pass</T></option>
                <option value="conditional_pass"><T>Conditional Pass</T></option>
                <option value="fail"><T>Fail</T></option>
              </select>
            </FilterField>
            <FilterField label={<T>Discipline</T>}>
              <select name="discipline" defaultValue={disciplineId ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>All disciplines</T></option>
                {(disciplines ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.code} - {d.name}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={<T>Sort</T>}>
              <select name="sort" defaultValue={sortKey} className={FILTER_CONTROL_CLASS}>
                <option value="newest"><T>Newest first</T></option>
                <option value="oldest"><T>Oldest first</T></option>
                <option value="date"><T>Assignment date</T></option>
                <option value="number"><T>Assignment no.</T></option>
              </select>
            </FilterField>
            <Button type="submit" variant="outline"><T>Apply filters</T></Button>
          </form>
        }
      />

      <StandaloneTable rows={assignments ?? []} totalCount={totalCount ?? 0} />
    </div>
  );
}
