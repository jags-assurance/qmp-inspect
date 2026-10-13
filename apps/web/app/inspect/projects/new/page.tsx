import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewProjectForm } from "./new-project-form";
import { PageGuide } from "@/components/domain/page-guide";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

export default async function NewProjectPage() {
  const tl = await getTranslator();
  const session = await requireSession();

  // Project setup is normally the Admin's job (client onboarding, commercial scope) — an Inspector
  // runs the day-to-day work on projects already set up. The exception: a Self-Managed (Hybrid) or
  // Full Client-Managed org (organizations.engagement_scope = 'self_managed' | 'client_managed',
  // supabase/migrations/20260919010000_self_managed_project_creation.sql) runs its own program on
  // the platform, so "the client manages its own projects" has to include creating them, not just
  // executing/creating ITPs inside ones JAGS already set up. Mirrors the RLS policy exactly: any
  // org this user's access reaches, filtered to engagement_scope in ('self_managed', 'client_managed').
  let organizations: { id: string; name: string }[] = [];
  const supabase = await createSupabaseServerClient();

  if (isAdminStaff(session)) {
    const { data } = await supabase.from("organizations").select("id, name").order("name");
    organizations = data ?? [];
  } else {
    const { data: grants } = await supabase
      .from("access_grants")
      .select("organization_id, organizations(id, name, engagement_scope)")
      .eq("user_id", session.userId)
      .returns<{ organization_id: string | null; organizations: { id: string; name: string; engagement_scope: string } | null }[]>();

    const seen = new Set<string>();
    for (const g of grants ?? []) {
      const org = g.organizations;
      if (org && (org.engagement_scope === "self_managed" || org.engagement_scope === "client_managed") && !seen.has(org.id)) {
        seen.add(org.id);
        organizations.push({ id: org.id, name: org.name });
      }
    }
    if (organizations.length === 0) redirect("/inspect/projects");
  }

  // Existing project numbers per organisation (RLS-scoped), so the form can suggest the next one.
  const { data: existingProjects } = await supabase
    .from("projects")
    .select("organization_id, project_number")
    .returns<{ organization_id: string; project_number: string }[]>();
  const existingNumbersByOrg: Record<string, string[]> = {};
  for (const p of existingProjects ?? []) (existingNumbersByOrg[p.organization_id] ??= []).push(p.project_number);

  let staffUsers: { id: string; full_name: string; email: string }[] = [];
  if (isAdminStaff(session)) {
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email")
      .eq("is_jags_staff", true)
      .eq("is_active", true)
      .order("full_name")
      .returns<{ id: string; full_name: string; email: string }[]>();
    staffUsers = data ?? [];
  }

  return (
    <div className="max-w-xl">
      <Link href="/inspect/projects" className="text-sm text-burgundy hover:underline">
        <T>← Back to Projects</T>
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink"><T>New project</T></h1>
        <PageGuide
          title={tl("New project — how this works")}
          points={[
            "Normally Admin-only — client onboarding and commercial scope are set up by JAGS.",
            "The exception: anyone whose organisation is on the Self-Managed (Hybrid) or Full Client-Managed engagement tier runs its own program on the platform, so they can create their own projects here too, scoped to their own organisation.",
            "An Admin can also create a brand-new client organisation from this form; a self-managed or client-managed user can only create projects under organisations they already have access to.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Set up a new project for a client organisation.</T></p>
      <NewProjectForm organizations={organizations} allowCreateOrg={isAdminStaff(session)} staffUsers={staffUsers} existingNumbersByOrg={existingNumbersByOrg} />
    </div>
  );
}
