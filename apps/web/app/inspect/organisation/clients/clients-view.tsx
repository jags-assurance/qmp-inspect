import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { NewOrganizationForm } from "./new-organization-form";
import { AiConsentControl } from "./ai-consent-control";
import { OrganizationLifecycleControl } from "./organization-lifecycle-control";
import { DangerDelete } from "@/components/domain/danger-delete";
import { deleteOrganizationAction, getOrganizationDeletePreviewAction } from "@/lib/projects/delete-actions";
import { describeConsentChange, groupConsentHistory, type AiConsentHistoryRow } from "@/lib/ai/consent-history";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

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
  const tl = await getTranslator();
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

  // Append-only record of who switched consent on/off and when (ai_consent_history, admin-readable).
  // Falls back to no history if that migration has not been applied.
  const { data: historyRows, error: historyError } = await untypedFrom(supabase, "ai_consent_history")
    .select("id, organization_id, consent, changed_at, users:changed_by(full_name)")
    .order("changed_at", { ascending: false })
    .limit(500)
    .returns<AiConsentHistoryRow[]>();
  if (historyError && !isMissingSchemaError(historyError)) console.error("ai_consent_history read failed", historyError.message);
  const consentHistoryByOrg = groupConsentHistory(historyRows ?? []);

  const projectCountByOrg = new Map<string, number>();
  for (const p of projects ?? []) {
    projectCountByOrg.set(p.organization_id, (projectCountByOrg.get(p.organization_id) ?? 0) + 1);
  }

  const activeOrgs = (organizations ?? []).filter((o) => o.is_active);
  const inactiveOrgs = (organizations ?? []).filter((o) => !o.is_active);

  const renderOrg = (org: OrganizationRow) => (
          <div key={org.id} className="rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">{org.name}</p>
                <p className="text-xs text-muted">
                  /{org.slug} · {ENGAGEMENT_MODE_LABEL[org.engagement_mode] ?? org.engagement_mode} ·{" "}
                  {projectCountByOrg.get(org.id) ?? 0} <T>project</T>{(projectCountByOrg.get(org.id) ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!org.is_active && <Badge tone="neutral"><T>Inactive</T></Badge>}
                <Badge tone={org.engagement_scope === "self_managed" || org.engagement_scope === "client_managed" ? "gold" : "neutral"}>
                  {ENGAGEMENT_SCOPE_LABEL[org.engagement_scope] ?? org.engagement_scope}
                </Badge>
                <Badge tone={org.ai_consent ? "info" : "neutral"}>
                  {org.ai_consent ? "AI consent given" : "No AI consent"}
                </Badge>
              </div>
            </div>
            <details className="group mt-3 border-t border-border pt-3">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-burgundy [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
                <T>Manage name, status, AI consent, history and delete</T>
              </summary>
                <OrganizationLifecycleControl organizationId={org.id} name={org.name} isActive={org.is_active} />
                <AiConsentControl organizationId={org.id} slug={org.slug} consent={org.ai_consent} />
                <div className="mt-3 text-xs text-muted">
                  <p className="font-medium text-ink"><T>AI consent history</T></p>
                  {(consentHistoryByOrg.get(org.id) ?? []).length === 0 ? (
                    <p><T>No consent changes recorded.</T></p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {(consentHistoryByOrg.get(org.id) ?? []).map((h) => (
                        <li key={h.id}>{describeConsentChange(h)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <DangerDelete
                  kind="organisation"
                  id={org.id}
                  confirmWord={org.name}
                  loadPreview={getOrganizationDeletePreviewAction}
                  action={deleteOrganizationAction}
                />
            </details>
          </div>
  );

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink"><T>Client organisations</T></Heading>
        <PageGuide
          title={tl("Client organisations — how this works")}
          points={[
            "Admin-only — creating and viewing the list of tenant organisations is an account-administration action, same boundary as Staff Access and Numbering.",
            "A new organisation starts with no projects, no AI consent, and JAGS-led branding — those are set up separately from this page (New project, Branding, Numbering).",
            "Everything else in the app (projects, ITPs, staff access grants, module licensing) is always scoped to one of these organisations, so this is the first step of onboarding a real client.",
            "Engagement scope shown here as a badge is one of three tiers, set under Numbering (not here): Full-Managed (JAGS runs the whole ITP workflow), Self-Managed/\"Hybrid\" (the client builds, submits and accepts its own ITPs and can self-serve branding/numbering/custom roles, but JAGS still approves ITPs and provisions client logins), or Full Client-Managed (all of that, plus the client's own permission-granted people can approve their own ITPs and provision their own team's logins, with no JAGS involvement day to day).",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        <T>Every client is an organisation here. Create one below when onboarding a new client; open an organisation to manage its AI consent or delete it.</T>
      </p>

      <NewOrganizationForm />

      <div className="mt-8 space-y-3">
        {activeOrgs.length === 0 && inactiveOrgs.length === 0 && (
          <p className="rounded-md border border-dashed border-border bg-off-white p-4 text-sm text-muted">
            <T>No client organisations yet — create the first one above.</T>
          </p>
        )}
        {activeOrgs.map(renderOrg)}
        {inactiveOrgs.length > 0 && (
          <details className="group pt-2">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-burgundy [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
              <T>Inactive organisations</T> ({inactiveOrgs.length})
            </summary>
            <div className="mt-2 space-y-3">{inactiveOrgs.map(renderOrg)}</div>
          </details>
        )}
      </div>
    </div>
  );
}
