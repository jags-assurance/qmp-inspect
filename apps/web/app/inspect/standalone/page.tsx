import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StandaloneTable, type StandaloneAssignmentListRow } from "./standalone-table";
import { STANDALONE_TABLE_PAGE_SIZE } from "./constants";
import { DisciplineFilterForm, type DisciplineOption } from "./discipline-filter-form";

export default async function StandaloneAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; q?: string; page?: string }>;
}) {
  const session = await requireSession();
  const { project: projectId, discipline: disciplineId, q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .eq("is_active", true)
    .order("sort_order")
    .returns<DisciplineOption[]>();

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
          <h1 className="text-2xl font-semibold text-ink">Standalone Assignments</h1>
          <p className="mt-1 text-sm text-muted">
            One-off FATs, witness inspections, specific tests and pre-shipment checks — no ITP or
            data book required.
          </p>
        </div>
        {session.isJagsStaff && (
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
