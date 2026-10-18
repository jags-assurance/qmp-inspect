import Link from "next/link";
import { T } from "@/components/domain/t";
import { Suspense } from "react";
import { SplitLayout } from "@/components/ui/split-layout";
import { ItpDetailView } from "./[id]/itp-detail-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { FilterBar } from "@/components/ui/toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { ItpsTable, type ItpRow } from "./itps-table";
import { ITP_STATUS_LABEL } from "./itp-status";
import { ITP_TABLE_PAGE_SIZE } from "./constants";
import { DisciplineFilterForm, type DisciplineOption } from "./discipline-filter-form";
import { PhaseFilterForm } from "./phase-filter-form";
import { ITP_PHASES, normalizeItpPhase } from "@/lib/itps/phase";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { SortForm } from "./sort-form";
import { ExportLink } from "@/components/domain/export-link";
import { computeActivityProgress, type ActivityProgress } from "@/lib/itps/progress";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";

export default async function ItpsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string; phase?: string; q?: string; page?: string; itp?: string; pane?: string; status?: string; sort?: string }>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId, phase: phaseParam, q, page: pageParam, itp, pane: paneParam, status: statusParam, sort: sortParam } = withActiveProject(await searchParams, await getActiveProjectId());
  const STATUSES = ["draft", "under_review", "approved", "client_accepted", "superseded", "withdrawn"] as const;
  const statusFilter = STATUSES.find((x) => x === statusParam) ?? null;
  const sort = ["number", "title", "status", "completion"].includes(sortParam ?? "") ? (sortParam as string) : "";
  // R23: optional phase filter — only a recognised phase value is honoured, anything else is
  // treated as "no filter" rather than silently matching zero rows.
  const phase = phaseParam && (ITP_PHASES as readonly string[]).includes(phaseParam) ? normalizeItpPhase(phaseParam) : null;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  // Client- or contractor-created ITPs (opt-in per project, or org-wide for a Self-Managed/
  // Platform-Only client — see itps/new/page.tsx's doc comment): show "+ New ITP" to a non-staff
  // user too if they're eligible on at least one project — mirrors the same eligibility check there
  // so the button never appears somewhere the page itself would then redirect away from.
  let canCreateItp = session.isJagsStaff;
  if (!canCreateItp) {
    const { data: eligibleParties } = await supabase
      .from("project_parties")
      .select(
        "project_id, party_type, projects!inner(allow_client_itp_creation, allow_contractor_itp_creation, organizations(engagement_scope))"
      )
      .in("party_type", ["client", "subcontractor", "main_contractor"])
      .eq("is_active", true)
      .eq("user_id", session.userId)
      .returns<
        {
          project_id: string;
          party_type: "client" | "subcontractor" | "main_contractor";
          projects: {
            allow_client_itp_creation: boolean;
            allow_contractor_itp_creation: boolean;
            organizations: { engagement_scope: string } | null;
          } | null;
        }[]
      >();
    canCreateItp = (eligibleParties ?? []).some((p) =>
      p.party_type === "client"
        ? p.projects?.allow_client_itp_creation ||
          p.projects?.organizations?.engagement_scope === "self_managed" ||
          p.projects?.organizations?.engagement_scope === "client_managed"
        : p.projects?.allow_contractor_itp_creation
    );
  }

  // Discipline-based routing (Reqs R32): filter the register down to ITPs that have at least one
  // activity tagged with the selected discipline, rather than filtering activities within an ITP —
  // this is a register-level view, so the useful question is "which ITPs involve this discipline",
  // not "which rows in this one ITP".
  //
  // `disciplines` (for the filter dropdown) and `taggedItems` (for the id filter) don't depend on
  // each other's results — only the later ITP queries depend on taggedItems — so they're fetched
  // together instead of waterfalled.
  const [disciplines, { data: taggedItems, error: taggedError }] = await Promise.all([
    getActiveMasterDisciplines(),
    disciplineId
      ? supabase
          .from("itp_items")
          .select("section_id, itp_sections(itp_id)")
          .eq("discipline_id", disciplineId)
          .returns<{ section_id: string; itp_sections: { itp_id: string } | null }[]>()
      : Promise.resolve({ data: null as { section_id: string; itp_sections: { itp_id: string } | null }[] | null, error: null }),
  ]);
  // A failed read must surface (error boundary), never render as an empty register.
  if (taggedError) throw new Error(`Failed to load discipline filter: ${taggedError.message}`);

  let itpIdFilter: string[] | null = null;
  if (disciplineId) {
    itpIdFilter = [...new Set((taggedItems ?? []).map((i) => i.itp_sections?.itp_id).filter((id): id is string => Boolean(id)))];
  }

  // Round-table performance finding (same pattern as apps/web/app/inspect/ncrs/page.tsx): this
  // register used to fetch every matching ITP at once and filter/paginate it client-side. Split
  // into a dedicated head:true count query (no embeds/joins/range) and a real server-side-
  // paginated + searched data query, kept separate rather than combining `{count:'exact'}` with
  // `.range()` on the same query — that combination was observed elsewhere in this app to return
  // an accurate count alongside a silently empty data array once embedded-resource joins were
  // involved. This register has no stat cards, so there's no need for a third "light stats" query.
  let countQuery = supabase.from("itps").select("id", { count: "exact", head: true });
  let tableQuery = supabase.from("itps").select("id, itp_number, title, status, revision, phase, projects(name)");

  if (itpIdFilter) {
    const noMatch = itpIdFilter.length === 0;
    countQuery = noMatch ? countQuery.eq("id", "00000000-0000-0000-0000-000000000000") : countQuery.in("id", itpIdFilter);
    tableQuery = noMatch ? tableQuery.eq("id", "00000000-0000-0000-0000-000000000000") : tableQuery.in("id", itpIdFilter);
  }
  if (projectId) {
    countQuery = countQuery.eq("project_id", projectId);
    tableQuery = tableQuery.eq("project_id", projectId);
  }
  if (statusFilter) {
    countQuery = countQuery.eq("status", statusFilter);
    tableQuery = tableQuery.eq("status", statusFilter);
  }
  if (phase) {
    countQuery = countQuery.eq("phase", phase);
    tableQuery = tableQuery.eq("phase", phase);
  }
  if (q) {
    // Search ITP number, title and the project's name / number. The project match is resolved to
    // project ids first (PostgREST cannot OR across an embedded table), then OR-ed in by project_id.
    const sq = q.replace(/[,()%*\\]/g, " ").trim();
    if (sq) {
      const { data: projectMatches, error: projectSearchError } = await supabase
        .from("projects")
        .select("id")
        .or(`name.ilike.%${sq}%,project_number.ilike.%${sq}%`)
        .limit(200)
        .returns<{ id: string }[]>();
      if (projectSearchError) throw new Error(`Failed to search projects: ${projectSearchError.message}`);
      const projectIds = (projectMatches ?? []).map((p) => p.id);
      const orClause = [`itp_number.ilike.%${sq}%`, `title.ilike.%${sq}%`, ...(projectIds.length ? [`project_id.in.(${projectIds.join(",")})`] : [])].join(",");
      countQuery = countQuery.or(orClause);
      tableQuery = tableQuery.or(orClause);
    }
  }

  const offset = (page - 1) * ITP_TABLE_PAGE_SIZE;
  const byCompletion = sort === "completion";
  // Completion is derived (not a column), so sorting by it ranks every matching ITP (capped) and
  // slices the page afterwards; every other sort is a plain server-side ORDER + RANGE.
  const COMPLETION_SORT_CAP = 1000;
  const orderCol = sort === "number" ? "itp_number" : sort === "title" ? "title" : sort === "status" ? "status" : "created_at";
  const orderedQuery = byCompletion
    ? tableQuery.order("created_at", { ascending: false }).limit(COMPLETION_SORT_CAP)
    : tableQuery.order(orderCol, { ascending: sort !== "" }).range(offset, offset + ITP_TABLE_PAGE_SIZE - 1);
  const [{ count: totalCount, error: countError }, { data: itpRows, error: rowsError }, statusCounts] = await Promise.all([
    countQuery,
    orderedQuery.returns<ItpRow[]>(),
    Promise.all(
      STATUSES.map(async (st) => {
        let c = supabase.from("itps").select("id", { count: "exact", head: true }).eq("status", st);
        if (itpIdFilter) c = itpIdFilter.length === 0 ? c.eq("id", "00000000-0000-0000-0000-000000000000") : c.in("id", itpIdFilter);
        if (projectId) c = c.eq("project_id", projectId);
        if (phase) c = c.eq("phase", phase);
        const { count, error } = await c;
        if (error) throw new Error(`Failed to count ${st} ITPs: ${error.message}`);
        return [st, count ?? 0] as const;
      })
    ),
  ]);
  if (countError) throw new Error(`Failed to count ITPs: ${countError.message}`);
  if (rowsError) throw new Error(`Failed to load ITPs: ${rowsError.message}`);

  // Activity sign-off progress: ONE batched read of the sign-off rows for all ITPs in play (paged
  // only to stay under the API row cap), grouped per ITP and reduced by the shared helper that
  // mirrors the ITP detail page's rule (an activity is done only when every party row is signed off).
  const candidateIds = (itpRows ?? []).map((r) => r.id);
  const rowsByItp = new Map<string, { itp_item_id: string; status: string }[]>();
  if (candidateIds.length > 0) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: so, error: soError } = await supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("itp_item_id, status, itp_items!inner(itp_sections!inner(itp_id))")
        .in("itp_items.itp_sections.itp_id", candidateIds)
        .order("id")
        .range(from, from + PAGE - 1)
        .returns<{ itp_item_id: string; status: string; itp_items: { itp_sections: { itp_id: string } } | null }[]>();
      if (soError) throw new Error(`Failed to load sign-off progress: ${soError.message}`);
      for (const row of so ?? []) {
        const id = row.itp_items?.itp_sections?.itp_id;
        if (!id) continue;
        const list = rowsByItp.get(id) ?? [];
        list.push({ itp_item_id: row.itp_item_id, status: row.status });
        rowsByItp.set(id, list);
      }
      if ((so ?? []).length < PAGE) break;
    }
  }
  const withProgress = (itpRows ?? []).map((r) => {
    const progress: ActivityProgress = computeActivityProgress(rowsByItp.get(r.id) ?? []);
    return { ...r, progress };
  });
  const itps = byCompletion
    ? withProgress
        .sort((a, b) => b.progress.percent - a.progress.percent || b.progress.complete - a.progress.complete || a.itp_number.localeCompare(b.itp_number))
        .slice(offset, offset + ITP_TABLE_PAGE_SIZE)
    : withProgress;

  // R91 — export the register (current filters, every matching row, not just this page) to Excel
  // (a real .xlsx workbook, see app/api/itps/export/route.ts) and PDF (a print view). Built from
  // the same filter params as the register itself.
  const exportParams = new URLSearchParams();
  if (disciplineId) exportParams.set("discipline", disciplineId);
  if (projectId) exportParams.set("project", projectId);
  if (phase) exportParams.set("phase", phase);
  if (statusFilter) exportParams.set("status", statusFilter);
  if (q) exportParams.set("q", q);
  const exportQuery = exportParams.toString();

  const backParams = new URLSearchParams();
  if (disciplineId) backParams.set("discipline", disciplineId);
  if (projectId) backParams.set("project", projectId);
  if (phaseParam) backParams.set("phase", phaseParam);
  if (statusFilter) backParams.set("status", statusFilter);
  if (sort) backParams.set("sort", sort);
  if (q) backParams.set("q", q);
  if (pageParam) backParams.set("page", pageParam);
  const backQuery = backParams.toString();
  const PANE_KEYS = ["details", "checklists", "status", "approval-roadmap"] as const;
  const pane = PANE_KEYS.find((k) => k === paneParam);
  const detailParams = new URLSearchParams(backParams);
  if (itp) detailParams.set("itp", itp);
  const detailQuery = detailParams.toString();
  const backHref = `/inspect/itps${backQuery ? `?${backQuery}` : ""}`;

  const activeFilterCount = [disciplineId, phase, sort].filter(Boolean).length;
  const chips = [
    { val: "", label: tl("All"), n: statusCounts.reduce((acc, [, n]) => acc + n, 0) },
    ...STATUSES.map((st) => ({ val: st as string, label: ITP_STATUS_LABEL[st], n: statusCounts.find(([k]) => k === st)?.[1] ?? 0 })),
  ].map(({ val, label, n }) => {
    const p = new URLSearchParams(backParams);
    p.delete("page");
    if (val) p.set("status", val);
    else p.delete("status");
    return {
      key: val || "all",
      label,
      count: n,
      href: `/inspect/itps${p.toString() ? `?${p.toString()}` : ""}`,
      active: (statusFilter ?? "") === val,
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0"
        title={<T>ITP Register</T>}
        guide={
          <PageGuide
            title={tl("ITP Register — how this works")}
            points={[
              "You see the ITPs of your own projects.",
              "\"+ New ITP\" shows only if you are allowed to create ITPs.",
              "The discipline filter lists ITPs with at least one activity in that discipline.",
              "PDF and Excel export every row of the current filter.",
            ]}
          />
        }
        primaryAction={
          canCreateItp ? (
            <Link href="/inspect/itps/new" className={buttonVariants()}>
              <T>+ New ITP</T>
            </Link>
          ) : undefined
        }
        secondaryActions={
          <>
            <Link href={`/inspect/itps/print${exportQuery ? `?${exportQuery}` : ""}`} className={buttonVariants({ variant: "outline" })}>
              <T>PDF</T>
            </Link>
            <ExportLink href={`/api/itps/export${exportQuery ? `?${exportQuery}` : ""}`} asButton pendingLabel="Preparing…">
              <T>Excel</T>
            </ExportLink>
          </>
        }
      />

      {projectId && (
        <p className="text-sm text-muted">
          <T>Filtered to one project.</T>{" "}
          <Link href="/inspect/itps?project=" className="font-medium text-brand hover:underline">
            <T>Clear filter</T>
          </Link>
        </p>
      )}

      <FilterChips label={tl("Filter by status")} items={chips} />

      <FilterBar
        activeCount={activeFilterCount}
        clearHref={activeFilterCount > 0 || q ? "/inspect/itps" : undefined}
        filters={
          <>
            <DisciplineFilterForm disciplines={disciplines ?? []} selectedDisciplineId={disciplineId ?? null} />
            <PhaseFilterForm selectedPhase={phase} />
            <SortForm
              current={sort}
              params={{
                ...(disciplineId ? { discipline: disciplineId } : {}),
                ...(projectId ? { project: projectId } : {}),
                ...(phase ? { phase } : {}),
                ...(q ? { q } : {}),
                ...(statusFilter ? { status: statusFilter } : {}),
              }}
            />
          </>
        }
      />

      {(totalCount ?? 0) === 0 && !q && canCreateItp && (
        <div className="rounded-lg border border-border bg-surface shadow-xs">
          <EmptyState
            compact
            title={<T>No ITPs match these filters.</T>}
            action={
              <Link href="/inspect/itps/new" className={buttonVariants({ variant: "outline" })}>
                <T>Create ITP</T>
              </Link>
            }
          />
        </div>
      )}

      <SplitLayout
        storageKey="itps"
        showDetail={!!itp}
        detailActions={
          itp ? (
            <Link href={`/inspect/itps/${itp}`} className="inline-flex min-h-9 items-center text-sm text-burgundy hover:underline">
              <T>Open full page →</T>
            </Link>
          ) : undefined
        }
        list={<ItpsTable rows={itps} totalCount={totalCount ?? 0} />}
        detail={
          itp ? (
            <>
              <div className="mb-3 lg:hidden">
                <Link href={backHref} className="inline-flex min-h-11 items-center text-sm text-burgundy hover:underline">
                  <T>← Back to list</T>
                </Link>
              </div>
              <Suspense
                key={itp}
                fallback={<div className="h-64 animate-pulse rounded-lg border border-border bg-surface" aria-label={tl("Loading ITP")} />}
              >
                <ItpDetailView id={itp} embedded pane={pane} baseQuery={detailQuery} />
              </Suspense>
            </>
          ) : null
        }
      />
    </div>
  );
}
