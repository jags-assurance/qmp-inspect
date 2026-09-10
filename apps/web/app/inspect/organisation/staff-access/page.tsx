import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StaffGrantForm, type StaffOption, type OrgOption, type ProjectOption } from "./staff-grant-form";
import { RemoveGrantButton } from "./remove-grant-button";

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  staff_role: "admin" | "inspector" | null;
}

interface GrantRow {
  id: string;
  user_id: string;
  scope_type: "global" | "organization" | "project";
  organization_id: string | null;
  project_id: string | null;
  role: string;
}

export default async function StaffAccessPage() {
  const session = await requireSession();
  // Deciding who has access to which clients is an Admin/account-administration concern, same
  // boundary as project creation and numbering settings — not a day-to-day Inspector task.
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const [{ data: staff }, { data: grants }, { data: organizations }, { data: projects }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, staff_role")
      .eq("is_jags_staff", true)
      .order("full_name")
      .returns<StaffRow[]>(),
    supabase
      .from("access_grants")
      .select("id, user_id, scope_type, organization_id, project_id, role")
      .returns<GrantRow[]>(),
    supabase.from("organizations").select("id, name").order("name").returns<OrgOption[]>(),
    supabase
      .from("projects")
      .select("id, name, organization_id")
      .order("name")
      .returns<ProjectOption[]>(),
  ]);

  const orgNameById = new Map((organizations ?? []).map((o) => [o.id, o.name]));
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const grantsByUser = new Map<string, GrantRow[]>();
  for (const grant of grants ?? []) {
    const list = grantsByUser.get(grant.user_id) ?? [];
    list.push(grant);
    grantsByUser.set(grant.user_id, list);
  }

  const staffOptions: StaffOption[] = (staff ?? []).map((s) => ({
    id: s.id,
    full_name: s.full_name,
    email: s.email,
  }));

  function describeScope(grant: GrantRow): string {
    if (grant.scope_type === "global") return "Global — every client";
    if (grant.scope_type === "organization") {
      return orgNameById.get(grant.organization_id ?? "") ?? "Unknown organisation";
    }
    return `${projectNameById.get(grant.project_id ?? "") ?? "Unknown project"} (${orgNameById.get(grant.organization_id ?? "") ?? "Unknown org"})`;
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Staff access</h1>
      <p className="mt-1 text-sm text-muted">
        Every JAGS staff account (Admin or Inspector) needs at least one access grant to see any
        client&apos;s data — <strong>Global</strong> reaches every organisation (the default for a
        new staff account), while <strong>Organisation</strong> or <strong>Project</strong> narrows
        an Inspector to only the clients they actually work with. This is a permission boundary
        enforced by the database itself (Row-Level Security), not just this screen.
      </p>

      <StaffGrantForm staff={staffOptions} organizations={organizations ?? []} projects={projects ?? []} />

      <div className="mt-8 space-y-4">
        {(staff ?? []).map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{s.full_name}</p>
                <p className="text-xs text-muted">
                  {s.email} · {s.staff_role === "inspector" ? "JAGS Inspector" : "JAGS Admin"}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {(grantsByUser.get(s.id) ?? []).length === 0 && (
                <p className="text-xs text-danger">
                  No access grants — this account can sign in but sees no client data at all.
                </p>
              )}
              {(grantsByUser.get(s.id) ?? []).map((grant) => (
                <div key={grant.id} className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    {describeScope(grant)} <span className="text-muted">— {grant.role}</span>
                  </span>
                  <RemoveGrantButton grantId={grant.id} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
