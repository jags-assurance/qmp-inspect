import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewProjectForm } from "./new-project-form";

export default async function NewProjectPage() {
  const session = await requireSession();
  // Project setup is the Admin's job (client onboarding, commercial scope) — an Inspector runs the
  // day-to-day work on projects already set up, matching the prototype's Admin/Inspector split.
  if (!isAdminStaff(session)) redirect("/inspect/projects");

  const supabase = await createSupabaseServerClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name");

  return (
    <div className="max-w-xl">
      <Link href="/inspect/projects" className="text-sm text-burgundy hover:underline">
        ← Back to Projects
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">New project</h1>
      <p className="mt-1 text-sm text-muted">Set up a new project for a client organisation.</p>
      <NewProjectForm organizations={organizations ?? []} />
    </div>
  );
}
