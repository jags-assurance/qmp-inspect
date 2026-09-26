import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { Button } from "@/components/ui/button";
import { StandaloneTable, type StandaloneAssignmentListRow } from "./standalone-table";
import { STANDALONE_TABLE_PAGE_SIZE } from "./constants";
import { DisciplineFilterForm } from "./discipline-filter-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";

export default async function StandaloneAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; q?: string; page?: string }>;
}) {
  const session = await requireSession();
  // Full Client-Managed tier: a run_standalone_assignment permission holder gets the same
  // "+ New assignment" affordance JAGS staff always had — org-wide check since we don't yet know
  // which project they'll pick; a project-scoped grant just won't show the button here (they'd
  // still succeed from a project-filtered view, this is only about this one link's visibility).
  const canRunStandaloneAssignment = session.isJagsStaff || (await hasPermission(session.userId, "run_standalone_assignment"));
  const { project: projectId, discipline: disciplineId, q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  const disciplines = await getActiveMasterDisciplines();

  // Round-table performance finding (same pattern as apps/web/app/inspect/ncrs/page.tsx): this
  // register used to fetch every matching assignment at once and filter/paginate it client-side.
  // Split into a dedicated head:true count query (no embeds/joins/range) and a real server-side-
  // paginated + searched data query, kept separate rather than combining `{count:'exact'}` with
  // `.range()` on the same query — that combination was observed elsewhere in this app to return
  // an accurate count alongside a silently empty data array once embedded-resource joins were
  // involved. This register has no stat cards, so there's no need for a third "light stats" query.
  let countQuery = supabase.from("standalone_assignments" as any).select("id", { count: "exact", head: true });
  let tableQuery = supabase
    .from("standalone_assignments" as any)
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
  if (q) {
    countQuery = countQuery.or(`assignment_number.ilike.%${q}%,equipment_description.ilike.%${q}%`);
    tableQuery = tableQuery.or(`assignment_number.ilike.%${q}%,equipment_description.ilike.%${q}%`);
  }

  const offset = (page - 1) * STANDALONE_TABLE_PAGE_SIZE;
  const [{ count: totalCount }, { data: assignments }] = await Promise.all([
    countQuery,
    tableQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + STANDALONE_TABLE_PAGE_SIZE - 1)
      .returns<StandaloneAssignmentListRow[]>(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">Standalone Assignments</h1>
            <PageGuide
              title="Standalone Assignments — how this works"
              points={[
                "One-off FATs, witness inspections, specific tests and pre-shipment checks that don't need an ITP or data book behind them.",
                "Running one is JAGS-staff-only end to end — creating, adding measurements/photos/punch items/signatures, finalizing and issuing clearance — UNLESS your organisation is on the Full Client-Managed tier and you specifically hold the \"Create and run a Standalone Assignment\" custom permission, in which case you can do all of it yourself too.",
                "A conditional pass leaves the assignment genuinely open (\"conditional_open\") until its linked punch-list item(s) are closed and clearance is issued — a clean pass or fail completes immediately on finalize.",
                "The discipline filter and search run server-side against the full register, not just the current page.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            One-off FATs, witness inspections, specific tests and pre-shipment checks — no ITP or
            data book required.
          </p>
        </div>
        {canRunStandaloneAssignment && (
          <Link href="/inspect/standalone/new">
            <Button>+ New assignment</Button>
          </Link>
        )}
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/standalone" className="text-burgundy hover:underline">
            Clear filter
          </Link>
        </p>
      )}

      <div className="mt-6">
        <DisciplineFilterForm disciplines={disciplines ?? []} selectedDisciplineId={disciplineId ?? null} />
      </div>

      <div className="mt-6">
        <StandaloneTable rows={assignments ?? []} totalCount={totalCount ?? 0} />
      </div>
    </div>
  );
}
