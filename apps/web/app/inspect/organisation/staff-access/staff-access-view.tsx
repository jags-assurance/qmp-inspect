import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StaffGrantForm, type StaffOption, type OrgOption, type ProjectOption } from "./staff-grant-form";
import { RemoveGrantButton } from "./remove-grant-button";
import { AccountStatusButton, BulkOffboardForm, OffboardByEmailForm } from "./account-status-controls";
import { PageGuide } from "@/components/domain/page-guide";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { MoreDetails } from "@/components/domain/more-details";

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  staff_role: "admin" | "inspector" | null;
  is_active: boolean | null;
}

interface GrantRow {
  id: string;
  user_id: string;
  scope_type: "global" | "organization" | "project";
  organization_id: string | null;
  project_id: string | null;
  role: string;
}

export async function StaffAccessView({ embedded }: { embedded?: boolean }) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  // Deciding who has access to which clients is an Admin/account-administration concern, same
  // boundary as project creation and numbering settings — not a day-to-day Inspector task.
  if (!isAdminStaff(session)) redirect("/inspect?denied=1");

  const supabase = await createSupabaseServerClient();

  const [{ data: staff }, { data: grants }, { data: organizations }, { data: projects }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, staff_role, is_active")
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

  const staffWithoutAccess = (staff ?? []).filter((s) => (grantsByUser.get(s.id) ?? []).length === 0).length;
  const adminCount = (staff ?? []).filter((s) => s.staff_role !== "inspector").length;

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className={embedded ? "text-lg font-semibold text-text-strong" : "text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"}><T>Staff access</T></Heading>
        <PageGuide
          title={tl("Staff access — how this works")}
          points={[
            "Admin-only — deciding who can see which client's data is an account-administration concern, same boundary as project creation and numbering settings.",
            "Every JAGS staff account (Admin or Field Engineer) needs at least one access grant to see any client's data at all — with none, the account can sign in but sees nothing.",
            "Global reaches every organisation (the default for a new staff account); Organisation or Project narrows a Field Engineer to only the clients they actually work with.",
            "This is enforced by Row-Level Security in the database, not just this screen — and a per-organisation seat_limit (set on Plans & Seats) can block a new grant for that org.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Who on JAGS staff can see which client data.</T></p>
      <MoreDetails className="mt-1">
        <p><T>Every JAGS staff account (Admin or Field Engineer) needs at least one access grant to see any client&apos;s data —</T> <strong><T>Global</T></strong> <T>reaches every organisation (the default for a new staff account), while</T> <strong><T>Organisation</T></strong> <T>or</T> <strong><T>Project</T></strong> <T>narrows a Field Engineer to only the clients they actually work with. This is a permission boundary enforced by the database itself (Row-Level Security), not just this screen.</T></p>
      </MoreDetails>
      <MoreDetails label="How the access screens fit together" className="mt-2">
      <p>
        <T>This is the first of four related Access &amp; Roles screens, read in order:</T> <strong><T>Staff Access</T></strong> <T>(this page) decides who has an account and which org/project they can reach at all;</T> <strong><T>Custom Roles</T></strong> <T>then decides what a specific person is additionally allowed to do on top of that;</T> <strong><T>Teams</T></strong> <T>groups staff so a team lead can delegate day-to-day actions on the projects their team is assigned to; and</T> <strong><T>Module Licensing</T></strong> <T>decides which modules exist for a client org&apos;s own people to be given any access to in the first place.</T>
      </p>
      </MoreDetails>

      <StatGrid max={4} className="mt-6">
        <StatTile label="Staff accounts" value={(staff ?? []).length} />
        <StatTile label="Admins" value={adminCount} />
        <StatTile label="Field Engineers" value={(staff ?? []).length - adminCount} />
        <StatTile
          label="No access grants"
          value={staffWithoutAccess}
          caption={staffWithoutAccess === 0 ? "Clear" : "Sees no client data"}
        />
      </StatGrid>

      <div className="mt-6">
        <StaffGrantForm staff={staffOptions} organizations={organizations ?? []} projects={projects ?? []} />
      </div>

      <div className="mt-6">
        <OffboardByEmailForm />
      </div>
      <div className="mt-4">
        <BulkOffboardForm />
      </div>

      <div className="mt-8 space-y-4">
        {(staff ?? []).map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{s.full_name}</p>
                <p className="text-xs text-muted">
                  {s.email} · {s.staff_role === "inspector" ? "JAGS Field Engineer" : "JAGS Admin"}
                  {s.is_active === false && <> · <span className="font-medium text-danger"><T>Deactivated</T></span></>}
                </p>
              </div>
              {s.id !== session.userId && (
                <AccountStatusButton userId={s.id} active={s.is_active !== false} name={s.full_name} />
              )}
            </div>
            <div className="mt-3 space-y-1.5">
              {(grantsByUser.get(s.id) ?? []).length === 0 && (
                <Badge tone="danger"><T>No access grants — sees no client data</T></Badge>
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
