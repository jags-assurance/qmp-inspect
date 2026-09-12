import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { NewOrganizationForm } from "./new-organization-form";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  engagement_mode: string;
  is_active: boolean;
  ai_consent: boolean;
  created_at: string;
}

const ENGAGEMENT_MODE_LABEL: Record<string, string> = {
  jags_led: "JAGS-led",
  co_branded: "Co-branded",
  white_label: "White-label",
};

/**
 * Client onboarding: create a new tenant (organisations row) here, then use New project / Numbering
 * settings / Staff Access to set that client up further — this page only handles the organisation
 * itself, not everything that can hang off it, matching how those other admin screens already work
 * against whatever organisations already exist.
 */
export default async function ClientOrganisationsPage() {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const [{ data: organizations }, { data: projects }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, slug, engagement_mode, is_active, ai_consent, created_at")
      .order("name")
      .returns<OrganizationRow[]>(),
    supabase.from("projects").select("organization_id").returns<{ organization_id: string }[]>(),
  ]);

  const projectCountByOrg = new Map<string, number>();
  for (const p of projects ?? []) {
    projectCountByOrg.set(p.organization_id, (projectCountByOrg.get(p.organization_id) ?? 0) + 1);
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Client organisations</h1>
      <p className="mt-1 text-sm text-muted">
        Every client this platform works with is an organisation (tenant) here — projects, ITPs,
        staff access grants and everything else are always scoped to one of these. Create a new one
        below when onboarding a real new client; each new organisation starts with no projects, no
        AI consent, and JAGS-led branding until you set those up separately.
      </p>

      <NewOrganizationForm />

      <div className="mt-8 space-y-3">
        {(organizations ?? []).length === 0 && (
          <p className="rounded-md border border-dashed border-border bg-off-white p-4 text-sm text-muted">
            No client organisations yet — create the first one above.
          </p>
        )}
        {(organizations ?? []).map((org) => (
          <div key={org.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">{org.name}</p>
                <p className="text-xs text-muted">
                  /{org.slug} · {ENGAGEMENT_MODE_LABEL[org.engagement_mode] ?? org.engagement_mode} ·{" "}
                  {projectCountByOrg.get(org.id) ?? 0} project{(projectCountByOrg.get(org.id) ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!org.is_active && <Badge tone="neutral">Inactive</Badge>}
                <Badge tone={org.ai_consent ? "info" : "neutral"}>
                  {org.ai_consent ? "AI consent given" : "No AI consent"}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
