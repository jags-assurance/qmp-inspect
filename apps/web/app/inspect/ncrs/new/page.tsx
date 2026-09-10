import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { NewNcrForm } from "./new-ncr-form";

export default async function NewNcrPage() {
  await requireSession();

  const supabase = await createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .order("name");

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-ink">Raise NCR / Observation</h1>
      <p className="mt-1 text-sm text-muted">
        Record a non-conformance or observation against a project — from a failed inspection, a
        walkdown, or standalone.
      </p>
      <NewNcrForm projects={projects ?? []} />
    </div>
  );
}
