import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StandaloneTable, type StandaloneAssignmentListRow } from "./standalone-table";

export default async function StandaloneAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await requireSession();
  const { project: projectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("standalone_assignments" as any)
    .select(
      "id, assignment_number, assignment_type, equipment_description, assignment_date, status, conclusion, projects(name)"
    )
    .order("created_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);

  const { data: assignments } = await query.returns<StandaloneAssignmentListRow[]>();

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
        <StandaloneTable rows={assignments ?? []} />
      </div>
    </div>
  );
}
