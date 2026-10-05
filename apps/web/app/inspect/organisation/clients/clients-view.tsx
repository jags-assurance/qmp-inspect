import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { NewOrganizationForm } from "./new-organization-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  engagement_mode: string;
  engagement_scope: string;
  is_active: boolean;
  ai_consent: boolean;
  created_at: string;
}

const ENGAGEMENT_MODE_LABEL: Record<string, string> = {
  jags_led: "JAGS-led",
  co_branded: "Co-branded",
  white_label: "White-label",
};

const ENGAGEMENT_SCOPE_LABEL: Record<string, string> = {
  full_service: "Full-Managed",
  self_managed: "Self-Managed",
  client_managed: "Full Client-Managed",
};

/**
 * Client onboarding: create a new tenant (organisations row) here, then use New project / Numbering
 * settings / Staff Access to set that client up further — this page only handles the organisation
 * itself, not everything that can hang off it, matching how those other admin screens already work
 * against whatever organisations already exist.
 */
export async function ClientOrganisationsView({ embedded }: { embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const [{ data: organizations }, { data: projects }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, slug, engagement_mode, engagement_scope, is_active, ai_consent, created_at")
      .order("created_at", { ascending: false })
      .returns<OrganizationRow[]>(),
    supabase.from("projects").select("organization_id").returns<{ organization_id: string }[]>(),
  ]);

  const projectCountByOrg = new Map<string, number>();
  for (const p of projects ?? []) {
    projectCountByOrg.set(p.organization_id, (projectCountByOrg.get(p.organization_id) ?? 0) + 1);
  }

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">Client organisations</Heading>
        <PageGuide
          title="Client organisations — how this works"
          points={[
            "Admin-only — creating and viewing the list of tenant organisations is an account-administration action, same boundary as Staff Access and Numbering.",
            "A new organisation starts with no projects, no AI consent, and JAGS-led branding — those are set up separately from this page (New project, Branding, Numbering).",
            "Everything else in the app (projects, ITPs, staff access grants, module licensing) is always scoped to one of these organisations, so this is the first step of onboarding a real client.",
            "Engagement scope shown here as a badge is one of three tiers, set under Numbering (not here): Full-Managed (JAGS runs the whole ITP workflow), Self-Managed/\"Hybrid\" (the client builds, submits and accepts its own ITPs and can self-serve branding/numbering/custom roles, but JAGS still approves ITPs and provisions client logins), or Full Client-Managed (all of that, plus the client's own permission-granted people can approve their own ITPs and provision their own team's logins, with no JAGS involvement day to day).",
          ]}
        />
      </div>
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
                <Badge tone={org.engagement_scope === "self_managed" || org.engagement_scope === "client_managed" ? "gold" : "neutral"}>
                  {ENGAGEMENT_SCOPE_LABEL[org.engagement_scope] ?? org.engagement_scope}
                </Badge>
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
