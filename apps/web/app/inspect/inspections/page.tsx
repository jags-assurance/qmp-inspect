import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { PageGuide } from "@/components/domain/page-guide";
import { Button } from "@/components/ui/button";
import { IRNS_TABLE } from "@/lib/checklists/db-types";
import { InspectionsTable, INSPECTIONS_PAGE_SIZE, type InspectionListRow } from "./inspections-table";

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
  await requireSession();
  const sp = await searchParams;
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
          : `id, record_number, project_name, itp_number, activity, location, inspection_date, overall_result, users(full_name)${embed}`,
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
    for (let i = 0; i < candIds.length; i += CHUNK) {
      const { data: liveRows } = await supabase
        .from(IRNS_TABLE)
        .select("inspection_record_id")
        .in("inspection_record_id", candIds.slice(i, i + CHUNK))
        .is("voided_at", null)
        .returns<{ inspection_record_id: string }[]>();
      for (const r of liveRows ?? []) live.add(r.inspection_record_id);
    }
    const noneIds = candIds.filter((cid) => !live.has(cid));
    count = noneIds.length;
    const pageIds = noneIds.slice(offset, offset + INSPECTIONS_PAGE_SIZE);
    if (pageIds.length) {
      const { data: pageRecs } = await supabase
        .from("inspection_records")
        .select("id, record_number, project_name, itp_number, activity, location, inspection_date, overall_result, users(full_name)")
        .in("id", pageIds)
        .returns<RecordQueryRow[]>();
      const order = new Map(pageIds.map((pid, i) => [pid, i]));
      recs = (pageRecs ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  } else {
    const [{ count: c }, { data: records }] = await Promise.all([
      build(true),
      build(false)
        .order("inspection_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + INSPECTIONS_PAGE_SIZE - 1)
        .returns<RecordQueryRow[]>(),
    ]);
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
  const inputCls = "rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-burgundy";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">Inspections</h1>
          <PageGuide
            title="Inspections — how this works"
            points={[
              "Lists every inspection record you can access, newest first. Open one to see its checklist responses, photos, signature, NCRs and IRN.",
              "Result shows Pass, Fail, Conditional (partial) or In progress while the checklist is not yet completed.",
              "IRN shows the Inspection Release Note number, or None if not issued yet; a voided IRN is marked VOID.",
              "Use the filters (project, result, IRN status, date range) and the search box; results are paged 50 at a time.",
              "Start a new inspection from Start work.",
            ]}
          />
        </div>
        <Link href="/inspect/start-work">
          <Button>Start work</Button>
        </Link>
      </div>

      <form method="get" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <select name="project" defaultValue={sp.project ?? ""} className={inputCls} aria-label="Project">
          <option value="">All projects</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="result" defaultValue={sp.result ?? ""} className={inputCls} aria-label="Result">
          <option value="">Any result</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="partial">Conditional</option>
          <option value="in_progress">In progress</option>
        </select>
        <select name="irn" defaultValue={sp.irn ?? ""} className={inputCls} aria-label="IRN status">
          <option value="">Any IRN status</option>
          <option value="issued">IRN issued</option>
          <option value="none">No IRN</option>
          <option value="void">IRN void</option>
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputCls} aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputCls} aria-label="To date" />
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          {hasFilters && (
            <Link href="/inspect/inspections" className="inline-flex items-center text-sm text-burgundy hover:underline">
              Clear
            </Link>
          )}
        </div>
        {sp.q && <input type="hidden" name="q" value={sp.q} />}
      </form>

      <div className="mt-6">
        {rows.length === 0 && !hasFilters ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
            No inspections recorded yet.{" "}
            <Link href="/inspect/start-work" className="text-burgundy hover:underline">
              Start work
            </Link>{" "}
            to begin one.
          </div>
        ) : (
          <InspectionsTable rows={rows} totalCount={count ?? 0} />
        )}
      </div>
    </div>
  );
}
