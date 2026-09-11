import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ItpsTable, type ItpRow } from "./itps-table";
import { DisciplineFilterForm, type DisciplineOption } from "./discipline-filter-form";

export default async function ItpsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string }>;
}) {
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .eq("is_active", true)
    .order("sort_order")
    .returns<DisciplineOption[]>();

  // Discipline-based routing (Reqs R32): filter the register down to ITPs that have at least one
  // activity tagged with the selected discipline, rather than filtering activities within an ITP —
  // this is a register-level view, so the useful question is "which ITPs involve this discipline",
  // not "which rows in this one ITP".
  let itpIdFilter: string[] | null = null;
  if (disciplineId) {
    const { data: taggedItems } = await supabase
      .from("itp_items")
      .select("section_id, itp_sections(itp_id)")
      .eq("discipline_id", disciplineId)
      .returns<{ section_id: string; itp_sections: { itp_id: string } | null }[]>();

    itpIdFilter = [...new Set((taggedItems ?? []).map((i) => i.itp_sections?.itp_id).filter((id): id is string => Boolean(id)))];
  }

  let query = supabase
    .from("itps")
    .select("id, itp_number, title, status, revision, projects(name)")
    .order("created_at", { ascending: false });

  if (itpIdFilter) {
    query = itpIdFilter.length > 0 ? query.in("id", itpIdFilter) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (projectId) query = query.eq("project_id", projectId);

  const { data: itps } = await query.returns<ItpRow[]>();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">ITP Register</h1>
          <p className="mt-1 text-sm text-muted">Inspection & Test Plans across your projects.</p>
        </div>
        {session.isJagsStaff && (
          <Link href="/inspect/itps/new">
            <Button>+ New ITP</Button>
          </Link>
        )}
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/itps" className="text-burgundy hover:underline">
            Clear filter
          </Link>
        </p>
      )}

      <div className="mt-6">
        <DisciplineFilterForm disciplines={disciplines ?? []} selectedDisciplineId={disciplineId ?? null} />
      </div>

      <div className="mt-6">
        <ItpsTable rows={itps ?? []} />
      </div>
    </div>
  );
}
