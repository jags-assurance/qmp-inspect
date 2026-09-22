import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ItpsTable, type ItpRow } from "./itps-table";
import { ITP_TABLE_PAGE_SIZE } from "./constants";
import { DisciplineFilterForm, type DisciplineOption } from "./discipline-filter-form";
import { PhaseFilterForm } from "./phase-filter-form";
import { ITP_PHASES, normalizeItpPhase } from "@/lib/itps/phase";

export default async function ItpsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string; phase?: string; q?: string; page?: string }>;
}) {
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId, phase: phaseParam, q, page: pageParam } = await searchParams;
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
        ? p.projects?.allow_client_itp_creation || p.projects?.organizations?.engagement_scope === "self_managed"
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
  const [{ data: disciplines }, { data: taggedItems }] = await Promise.all([
    supabase
      .from("master_disciplines")
      .select("id, code, name")
      .eq("is_active", true)
      .order("sort_order")
      .returns<DisciplineOption[]>(),
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
  if (phase) {
    countQuery = countQuery.eq("phase", phase);
    tableQuery = tableQuery.eq("phase", phase);
  }
  if (q) {
    countQuery = countQuery.or(`itp_number.ilike.%${q}%,title.ilike.%${q}%`);
    tableQuery = tableQuery.or(`itp_number.ilike.%${q}%,title.ilike.%${q}%`);
  }

  const offset = (page - 1) * ITP_TABLE_PAGE_SIZE;
  const [{ count: totalCount }, { data: itps }] = await Promise.all([
    countQuery,
    tableQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + ITP_TABLE_PAGE_SIZE - 1)
      .returns<ItpRow[]>(),
  ]);

  // R91 — export the register (current filters, every matching row, not just this page) to Excel
  // (CSV) and PDF (a print view). Built from the same filter params as the register itself.
  const exportParams = new URLSearchParams();
  if (disciplineId) exportParams.set("discipline", disciplineId);
  if (projectId) exportParams.set("project", projectId);
  if (phase) exportParams.set("phase", phase);
  if (q) exportParams.set("q", q);
  const exportQuery = exportParams.toString();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">ITP Register</h1>
          <p className="mt-1 text-sm text-muted">Inspection & Test Plans across your projects.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/inspect/itps/print${exportQuery ? `?${exportQuery}` : ""}`}>
            <Button variant="outline">PDF</Button>
          </Link>
          <a href={`/api/itps/export${exportQuery ? `?${exportQuery}` : ""}`}>
            <Button variant="outline">Excel</Button>
          </a>
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

      <div className="mt-6 flex flex-wrap gap-4">
        <DisciplineFilterForm disciplines={disciplines ?? []} selectedDisciplineId={disciplineId ?? null} />
        <PhaseFilterForm selectedPhase={phase} />
      </div>

      <div className="mt-6">
        <ItpsTable rows={itps ?? []} totalCount={totalCount ?? 0} />
      </div>
    </div>
  );
}
