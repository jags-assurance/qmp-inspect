import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewAssignmentForm } from "./new-assignment-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { PageGuide } from "@/components/domain/page-guide";

export default async function NewStandaloneAssignmentPage() {
  const session = await requireSession();
  // Booking/running a standalone FAT/witness/test assignment is JAGS staff's job by default, same
  // boundary as ITP creation (apps/web/app/inspect/itps/new/page.tsx) — UNLESS this person holds the
  // run_standalone_assignment custom permission (Full Client-Managed tier only). RLS on `projects`
  // below still scopes what they can actually select to their own org's projects regardless.
  if (!session.isJagsStaff && !(await hasPermission(session.userId, "run_standalone_assignment"))) {
    redirect("/inspect/standalone");
  }

  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("name");
  const disciplines = await getActiveMasterDisciplines();

  return (
    <div className="max-w-2xl">
      <Link href="/inspect/standalone" className="text-sm text-burgundy hover:underline">
        ← Back to Assignments
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">New assignment</h1>
        <PageGuide
          title="New assignment — how this works"
          points={[
            "Only JAGS staff can reach this page by default — booking/running a standalone FAT, witness inspection, specific test or pre-shipment check is JAGS staff's job, same boundary as ITP creation — unless your organisation is Full Client-Managed and you hold the run_standalone_assignment custom permission.",
            "The assignment number is generated automatically on save, with a type-specific prefix (FAT/WI/ST/PS) — never hand-entered.",
            "This only creates the assignment shell; measurements, photos, punch items and signatures are then added from the assignment's own detail page, gated the same way as this page.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Set up a one-off FAT, witness inspection, specific test or pre-shipment check. The
        assignment number is generated automatically once you save.
      </p>
      <NewAssignmentForm projects={projects ?? []} disciplines={disciplines ?? []} />
    </div>
  );
}
