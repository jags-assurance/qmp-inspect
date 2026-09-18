import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewAssignmentForm } from "./new-assignment-form";

export default async function NewStandaloneAssignmentPage() {
  const session = await requireSession();
  // Booking/running a standalone FAT/witness/test assignment is JAGS staff's job, same boundary as
  // ITP creation (apps/web/app/inspect/itps/new/page.tsx) — this page had no gate at all before.
  if (!session.isJagsStaff) redirect("/inspect/standalone");

  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("name");
  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <div className="max-w-2xl">
      <Link href="/inspect/standalone" className="text-sm text-burgundy hover:underline">
        ← Back to Assignments
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">New assignment</h1>
      <p className="mt-1 text-sm text-muted">
        Set up a one-off FAT, witness inspection, specific test or pre-shipment check. The
        assignment number is generated automatically once you save.
      </p>
      <NewAssignmentForm projects={projects ?? []} disciplines={disciplines ?? []} />
    </div>
  );
}
