import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ProjectsTable, type ProjectRow } from "./projects-table";

export default async function ProjectsPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name, site_location, status, organizations(name)")
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Every project across every client you have access to."
              : "Projects your organisation is engaged on."}
          </p>
        </div>
        {isAdminStaff(session) && (
          <Link href="/inspect/projects/new">
            <Button>+ New project</Button>
          </Link>
        )}
      </div>

      <div className="mt-6">
        <ProjectsTable rows={projects ?? []} />
      </div>
    </div>
  );
}
