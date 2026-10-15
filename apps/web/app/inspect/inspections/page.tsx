import Link from "next/link";
import { T } from "@/components/domain/t";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { PageGuide } from "@/components/domain/page-guide";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar, FilterField } from "@/components/ui/toolbar";
import { FilterChips, type FilterChip } from "@/components/ui/filter-chips";
import { FILTER_CONTROL_CLASS } from "@/components/ui/filter-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusLegend } from "@/components/ui/status-legend";
import { IRNS_TABLE } from "@/lib/checklists/db-types";
import { InspectionsTable, type InspectionListRow } from "./inspections-table";
import { INSPECTIONS_PAGE_SIZE } from "./page-size";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";

type Params = {
  project?: string;
  result?: string;
  irn?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
};

type RecordQueryRow = {
  id: string;
  record_number: string;
  project_name: string;
  itp_number: string;
  activity: string;
  location: string | null;
  inspection_date: string;
  overall_result: "pass" | "fail" | "partial" | null;
  users: { full_name: string | null } | null;
};

const NO_MATCH = "00000000-0000-0000-0000-000000000000";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const tl = await getTranslator();
  await requireSession();
  const sp = withActiveProject(await searchParams, await getActiveProjectId());
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("name")
    .returns<{ id: string; name: string }[]>();

  // IRN status filter. issued/void use an embedded inner join on irns (no id lists in the URL).
  // "none" (no live IRN) cannot be an inner join, so it is resolved over a bounded window of
  // candidate record ids, checked against irns in chunks of 200 ids (see below).
  const irnMode: "issued" | "void" | "none" | null =
    sp.irn === "issued" || sp.irn === "none" || sp.irn === "void" ? sp.irn : null;
  const NONE_WINDOW = 2000;
  const CHUNK = 200;

  const build = (head: boolean, idsOnly = false) => {
    const embed = irnMode === "issued" || irnMode === "void" ? ", irns!inner(voided_at)" : "";
    let query = supabase
      .from("inspection_records")
      .select(
        head || idsOnly
          ? `id${embed}`
          : `id, record_number, project_name, itp_number, activity, location, inspection_date, overall_result, users!inspection_records_inspector_id_fkey(full_name)${embed}`,
        head ? { count: "exact", head: true } : undefined
      );
    if (irnMode === "issued") query = query.is("irns.voided_at", null);
    else if (irnMode === "void") query = query.not("irns.voided_at", "is", null);
    if (sp.project) query = query.eq("project_id", sp.project);
    if (sp.result === "in_progress") query = query.is("overall_result", null);
    else if (sp.result === "pass" || sp.result === "fail" || sp.result === "partial") query = query.eq("overall_result", sp.result);
    if (sp.from && DATE_RE.test(sp.from)) query = query.gte("inspection_date", sp.from);
    if (sp.to && DATE_RE.test(sp.to)) query = query.lte("inspection_date", sp.to);
    if (sp.q) {
      const safe = sp.q.replace(/[,()%*\\]/g, " ").trim();
      if (safe) query = query.or(`record_number.ilike.%${safe}%,activity.ilike.%${safe}%,itp_number.ilike.%${safe}%`);
    }
    return query;
  };

  const offset = (page - 1) * INSPECTIONS_PAGE_SIZE;
  let count: number | null = 0;
  let recs: RecordQueryRow[] = [];
  if (irnMode === "none") {
    const { data: cand } = await build(false, true)
      .order("inspection_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(NONE_WINDOW)
      .returns<{ id: string }[]>();
    const candIds = (cand ?? []).map((c) => c.id);
    const live = new Set<string>();
    // The chunk lookups are independent, so they run together instead of one after another.
    const chunks: string[][] = [];
    for (let i = 0; i < candIds.length; i += CHUNK) chunks.push(candIds.slice(i, i + CHUNK));
    const liveResults = await Promise.all(
      chunks.map((chunkIds) =>
        supabase
          .from(IRNS_TABLE)
          .select("inspection_record_id")
          .in("inspection_record_id", chunkIds)
          .is("voided_at", null)
          .returns<{ inspection_record_id: string }[]>()
      )
    );
    for (const { data: liveRows } of liveResults) for (const r of liveRows ?? []) live.add(r.inspection_record_id);
    const noneIds = candIds.filter((cid) => !live.has(cid));
    count = noneIds.length;
    const pageIds = noneIds.slice(offset, offset + INSPECTIONS_PAGE_SIZE);
    if (pageIds.length) {
      const { data: pageRecs, error: pageError } = await supabase
        .from("inspection_records")
        .select("id, record_number, project_name, itp_number, activity, location, inspection_date, overall_result, users!inspection_records_inspector_id_fkey(full_name)")
        .in("id", pageIds)
        .returns<RecordQueryRow[]>();
      if (pageError) throw new Error(`Could not load the inspections list: ${pageError.message}`);
      const order = new Map(pageIds.map((pid, i) => [pid, i]));
      recs = (pageRecs ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  } else {
    const [{ count: c }, { data: records, error: recordsError }] = await Promise.all([
      build(true),
      build(false)
        .order("inspection_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + INSPECTIONS_PAGE_SIZE - 1)
        .returns<RecordQueryRow[]>(),
    ]);
    // A failed row query used to render as an empty register beside a correct count.
    if (recordsError) throw new Error(`Could not load the inspections list: ${recordsError.message}`);
    count = c;
    recs = records ?? [];
  }

  const ids = recs.map((r) => r.id);
  const [{ data: irns }, { data: ncrs }] = ids.length
    ? await Promise.all([
        supabase
          .from(IRNS_TABLE)
          .select("inspection_record_id, irn_number, voided_at")
          .in("inspection_record_id", ids)
          .returns<{ inspection_record_id: string; irn_number: string; voided_at: string | null }[]>(),
        supabase
          .from("ncrs")
          .select("inspection_record_id, status")
          .in("inspection_record_id", ids)
          .neq("status", "closed")
          .returns<{ inspection_record_id: string; status: string }[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  // Prefer the live IRN; otherwise show the latest voided one (rows arrive unordered, so rank here).
  const irnByRecord = new Map<string, { inspection_record_id: string; irn_number: string; voided_at: string | null }>();
  for (const i of irns ?? []) {
    const cur = irnByRecord.get(i.inspection_record_id);
    if (!cur || (cur.voided_at && !i.voided_at) || (cur.voided_at && i.voided_at && i.voided_at > cur.voided_at)) {
      irnByRecord.set(i.inspection_record_id, i);
    }
  }
  const ncrCount = new Map<string, number>();
  for (const n of ncrs ?? []) ncrCount.set(n.inspection_record_id, (ncrCount.get(n.inspection_record_id) ?? 0) + 1);

  const rows: InspectionListRow[] = recs.map((r) => {
    const irn = irnByRecord.get(r.id);
    return {
      id: r.id,
      record_number: r.record_number,
      project_name: r.project_name,
      itp_number: r.itp_number,
      activity: r.activity,
      location: r.location,
      inspection_date: r.inspection_date,
      overall_result: r.overall_result,
      inspector_name: r.users?.full_name ?? null,
      irn_number: irn?.irn_number ?? null,
      irn_voided: !!irn?.voided_at,
      open_ncrs: ncrCount.get(r.id) ?? 0,
    };
  });

  const hasFilters = !!(sp.project || sp.result || sp.irn || sp.from || sp.to || sp.q);
  const activeFilterCount = [sp.project, sp.result, sp.irn, sp.from, sp.to].filter(Boolean).length;

  // Result quick filters keep every other filter (project, IRN, dates, search) and reset paging.
  const chipHref = (result: string | null) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "result" && k !== "page") qs.set(k, v);
    if (result) qs.set("result", result);
    const str = qs.toString();
    return str ? `/inspect/inspections?${str}` : "/inspect/inspections";
  };
  const resultChips: FilterChip[] = [
    { key: "all", label: tl("All"), href: chipHref(null), active: !sp.result },
    { key: "in_progress", label: tl("In progress"), href: chipHref("in_progress"), active: sp.result === "in_progress" },
    { key: "pass", label: tl("Pass"), href: chipHref("pass"), active: sp.result === "pass" },
    { key: "partial", label: tl("Conditional"), href: chipHref("partial"), active: sp.result === "partial" },
    { key: "fail", label: tl("Fail"), href: chipHref("fail"), active: sp.result === "fail" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        className="mb-0"
        title={<T>Inspections</T>}
        guide={
          <PageGuide
            title={tl("Inspections — how this works")}
            points={[
              "Lists every inspection record you can access, newest first. Open one to see its checklist responses, photos, signature, NCRs and IRN.",
              "Result shows Pass, Fail, Conditional (partial) or In progress while the checklist is not yet completed.",
              "IRN shows the Inspection Release Note number, or None if not issued yet; a voided IRN is marked VOID.",
              "Use the filters (project, result, IRN status, date range) and the search box; results are paged 50 at a time.",
              "Start a new inspection from Start work.",
            ]}
          />
        }
        primaryAction={
          <Link href="/inspect/start-work" className={buttonVariants()}>
            <T>Start work</T>
          </Link>
        }
      />

      <FilterChips label={tl("Filter by result")} items={resultChips} />

      <FilterBar
        activeCount={activeFilterCount}
        clearHref={hasFilters ? "/inspect/inspections" : undefined}
        filters={
          <form method="get" className="flex w-full flex-col gap-4 md:w-auto md:flex-row md:flex-wrap md:items-end md:gap-3">
            <FilterField label={<T>Project</T>}>
              <select name="project" defaultValue={sp.project ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>All projects</T></option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={<T>Result</T>}>
              <select name="result" defaultValue={sp.result ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>Any result</T></option>
                <option value="pass"><T>Pass</T></option>
                <option value="fail"><T>Fail</T></option>
                <option value="partial"><T>Conditional</T></option>
                <option value="in_progress"><T>In progress</T></option>
              </select>
            </FilterField>
            <FilterField label={<T>IRN status</T>}>
              <select name="irn" defaultValue={sp.irn ?? ""} className={FILTER_CONTROL_CLASS}>
                <option value=""><T>Any IRN status</T></option>
                <option value="issued"><T>IRN issued</T></option>
                <option value="none"><T>No IRN</T></option>
                <option value="void"><T>IRN void</T></option>
              </select>
            </FilterField>
            <FilterField label={<T>From date</T>}>
              <input type="date" name="from" defaultValue={sp.from ?? ""} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label={<T>To date</T>}>
              <input type="date" name="to" defaultValue={sp.to ?? ""} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <Button type="submit" variant="outline"><T>Apply</T></Button>
          </form>
        }
      />

      <div>
        {rows.length === 0 && !hasFilters ? (
          <div className="rounded-lg border border-border bg-surface shadow-xs">
            <EmptyState
              title={<T>No inspections recorded yet.</T>}
              description={<T>Inspections appear here once a checklist is started from Start work.</T>}
              action={
                <Link href="/inspect/start-work" className={buttonVariants({ size: "sm" })}>
                  <T>Start work</T>
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <StatusLegend className="mb-2" />
            <InspectionsTable rows={rows} totalCount={count ?? 0} />
          </>
        )}
      </div>
    </div>
  );
}
