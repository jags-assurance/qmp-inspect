import Link from "next/link";
import { Suspense } from "react";
import { SplitLayout } from "@/components/ui/split-layout";
import { ItpDetailView } from "./[id]/itp-detail-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ItpsTable, ITP_STATUS_LABEL, type ItpRow } from "./itps-table";
import { ITP_TABLE_PAGE_SIZE } from "./constants";
import { DisciplineFilterForm, type DisciplineOption } from "./discipline-filter-form";
import { PhaseFilterForm } from "./phase-filter-form";
import { ITP_PHASES, normalizeItpPhase } from "@/lib/itps/phase";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";
import { SortForm } from "./sort-form";
import { ExportLink } from "@/components/domain/export-link";

export default async function ItpsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string; phase?: string; q?: string; page?: string; itp?: string; pane?: string; status?: string; sort?: string }>;
}) {
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId, phase: phaseParam, q, page: pageParam, itp, pane: paneParam, status: statusParam, sort: sortParam } = await searchParams;
  const STATUSES = ["draft", "under_review", "approved", "client_accepted", "superseded", "withdrawn"] as const;
  const statusFilter = STATUSES.find((x) => x === statusParam) ?? null;
  const sort = ["number", "title", "status"].includes(sortParam ?? "") ? (sortParam as string) : "";
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
  const [disciplines, { data: taggedItems }] = await Promise.all([
    getActiveMasterDisciplines(),
    disciplineId
      ? supabase
          .from("itp_items")
          .select("section_id, itp_sections(itp_id)")
          .eq("discipline_id", disciplineId)
          .returns<{ section_id: string; itp_sections: { itp_id: string } | null }[]>()
      : Promise.resolve({ data: null as { section_id: string; itp_sections: { itp_id: string } | null }[] | null }),
  ]);

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
    const sq = q.replace(/[,()%*]/g, " ").trim();
    countQuery = countQuery.or(`itp_number.ilike.%${sq}%,title.ilike.%${sq}%`);
    tableQuery = tableQuery.or(`itp_number.ilike.%${sq}%,title.ilike.%${sq}%`);
  }

  const offset = (page - 1) * ITP_TABLE_PAGE_SIZE;
  const orderCol = sort === "number" ? "itp_number" : sort === "title" ? "title" : sort === "status" ? "status" : "created_at";
  const [{ count: totalCount }, { data: itpRows }, statusCounts] = await Promise.all([
    countQuery,
    tableQuery
      .order(orderCol, { ascending: sort !== "" })
      .range(offset, offset + ITP_TABLE_PAGE_SIZE - 1)
      .returns<ItpRow[]>(),
    Promise.all(
      STATUSES.map(async (st) => {
        let c = supabase.from("itps").select("id", { count: "exact", head: true }).eq("status", st);
        if (itpIdFilter) c = itpIdFilter.length === 0 ? c.eq("id", "00000000-0000-0000-0000-000000000000") : c.in("id", itpIdFilter);
        if (projectId) c = c.eq("project_id", projectId);
        if (phase) c = c.eq("phase", phase);
        const { count } = await c;
        return [st, count ?? 0] as const;
      })
    ),
  ]);

  // % activities signed: one batched query over the sign-off rows of this page's ITPs.
  const pageIds = (itpRows ?? []).map((r) => r.id);
  const progress = new Map<string, { signed: number; total: number }>();
  if (pageIds.length > 0) {
    const { data: so } = await supabase
      .from("activity_signoff_progress")
      .select("status, itp_items!inner(itp_sections!inner(itp_id))")
      .in("itp_items.itp_sections.itp_id", pageIds)
      .limit(10000)
      .returns<{ status: string; itp_items: { itp_sections: { itp_id: string } } | null }[]>();
    for (const row of so ?? []) {
      const id = row.itp_items?.itp_sections?.itp_id;
      if (!id) continue;
      const cur = progress.get(id) ?? { signed: 0, total: 0 };
      cur.total += 1;
      if (row.status === "signed_off" || row.status === "proceeded_no_response") cur.signed += 1;
      progress.set(id, cur);
    }
  }
  const itps = (itpRows ?? []).map((r) => ({ ...r, signed: progress.get(r.id)?.signed ?? 0, signTotal: progress.get(r.id)?.total ?? 0 }));

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

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">ITP Register</h1>
            <PageGuide
              title="ITP Register — how this works"
              points={[
                "Every Inspection & Test Plan across your accessible projects — staff see all of them, others see only what RLS scopes to their organisation/project.",
                "\"+ New ITP\" appears for JAGS staff always, and for a client or subcontractor/main-contractor login only if their project has opted them into ITP creation (or their organisation is Self-Managed/\"Hybrid\" or Full Client-Managed, either of which grants it org-wide for a client party).",
                "The discipline filter is register-level: it shows every ITP that has at least one activity tagged with that discipline, not just activities within one ITP.",
                "PDF and Excel export the current filtered view — every matching row, not just the current page.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">Inspection & Test Plans across your projects.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/inspect/itps/print${exportQuery ? `?${exportQuery}` : ""}`}>
            <Button variant="outline">PDF</Button>
          </Link>
          <ExportLink href={`/api/itps/export${exportQuery ? `?${exportQuery}` : ""}`} asButton pendingLabel="Preparing…">
            Excel
          </ExportLink>
          {canCreateItp && (
            <Link href="/inspect/itps/new">
              <Button>+ New ITP</Button>
            </Link>
          )}
        </div>
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/itps" className="text-burgundy hover:underline">
            Clear filter
          </Link>
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3">
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
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {[
          { val: "", label: "All", n: statusCounts.reduce((a, [, n]) => a + n, 0) },
          ...STATUSES.map((st) => ({ val: st as string, label: ITP_STATUS_LABEL[st], n: statusCounts.find(([k]) => k === st)?.[1] ?? 0 })),
        ].map(({ val, label, n }) => {
          const p = new URLSearchParams(backParams);
          p.delete("page");
          if (val) p.set("status", val);
          else p.delete("status");
          const active = (statusFilter ?? "") === val;
          return (
            <Link
              key={val || "all"}
              href={`/inspect/itps${p.toString() ? `?${p.toString()}` : ""}`}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm ${active ? "border-burgundy bg-burgundy text-white" : "border-border bg-surface text-ink hover:bg-off-white"}`}
            >
              {label} ({n})
            </Link>
          );
        })}
      </div>

      {(totalCount ?? 0) === 0 && !q && canCreateItp && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
          No ITPs match these filters.{" "}
          <Link href="/inspect/itps/new" className="inline-flex min-h-11 items-center font-medium text-burgundy hover:underline">
            Create ITP
          </Link>
        </div>
      )}

      <SplitLayout
        storageKey="itps"
        showDetail={!!itp}
        detailActions={
          itp ? (
            <Link href={`/inspect/itps/${itp}`} className="inline-flex min-h-9 items-center text-sm text-burgundy hover:underline">
              Open full page →
            </Link>
          ) : undefined
        }
        list={<ItpsTable rows={itps} totalCount={totalCount ?? 0} />}
        detail={
          itp ? (
            <>
              <div className="mb-3 lg:hidden">
                <Link href={backHref} className="inline-flex min-h-11 items-center text-sm text-burgundy hover:underline">
                  ← Back to list
                </Link>
              </div>
              <Suspense
                key={itp}
                fallback={<div className="h-64 animate-pulse rounded-lg border border-border bg-surface" aria-label="Loading ITP" />}
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
