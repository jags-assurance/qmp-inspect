import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { INTERVENTION_LEVEL_TYPES_TABLE, sortLevels, type InterventionLevelTypeRow } from "@/lib/intervention-levels/types";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { LevelRowForm } from "./level-row-form";
import { AddLevelForm } from "./add-level-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

interface OrganizationOption {
  id: string;
  name: string;
}

/**
 * Lets a JAGS Admin view/add/reorder/rename an organisation's ITP intervention (sign-off) levels —
 * previously a hardcoded 4-value H/W/R/S enum (see supabase/migrations/
 * 20260909230000_phase1_itp_core.sql), now custom and hierarchical per organisation (supabase/
 * migrations/20260917090000_configurable_intervention_levels.sql). Every org is seeded with the
 * same four built-in levels (Hold/Witness/Review/Surveillance) that can be freely renamed/reordered/
 * reclassified, plus any number of custom levels added here (e.g. a 5th "Client QA Review").
 *
 * Admin-only, same page-shape convention as numbering/branding/plans: an org picker up top, then a
 * focused settings panel for whichever org is selected.
 */
export async function InterventionLevelsSettingsView({ searchParams, embedded }: {
  searchParams: { org?: string };
  embedded?: boolean;
}) {
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const { org: orgIdParam } = searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name")
    .returns<OrganizationOption[]>();

  const selectedOrg = organizations?.find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

  let levels: InterventionLevelTypeRow[] = [];
  if (selectedOrg) {
    const { data } = await supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("id, organization_id, code, label, sort_order, is_blocking, default_notice_hours, created_at")
      .eq("organization_id", selectedOrg.id)
      .returns<InterventionLevelTypeRow[]>();
    levels = sortLevels(data ?? []);
  }

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">Intervention (sign-off) levels</Heading>
        <PageGuide
          title="Intervention (sign-off) levels — how this works"
          points={[
            "Admin-only, same page-shape convention as Numbering/Branding/Plans — an org picker up top, then a focused settings panel for whichever org is selected.",
            "Every org is seeded with the same four built-in levels (Hold/Witness/Review/Surveillance), but they're fully custom per organisation now: freely renamed, reordered or reclassified, plus any number of custom levels added here.",
            "A blocking level (like Hold) stops an inspection completing until it's signed off; a non-blocking level doesn't — that flag is what other pages (e.g. Portfolio Insights' hold-point turnaround) key off.",
            "Default notice hours is how long the originator waits before a non-blocking level can \"proceed without response\" — leave blank for none.",
            "Party sign-off sequencing (whether non-blocking levels must also clear in sort order, like blocking levels already do) is configured separately, on the Numbering page.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Every ITP activity's per-party sign-off level (Hold/Witness/Review/Surveillance by default)
        is now custom per organisation, not a fixed set. A <strong>blocking</strong> level (like Hold)
        stops an inspection completing until it&rsquo;s signed off; a non-blocking level doesn&rsquo;t.
        Default notice hours is how long the originator waits before a non-blocking level can
        &ldquo;proceed without response&rdquo; — leave blank for none.
      </p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{selectedOrg.name}&rsquo;s levels</h2>

          <div className="mt-3 divide-y divide-border">
            {levels.map((level) => (
              <LevelRowForm key={level.id} level={level} />
            ))}
            {levels.length === 0 && <p className="py-4 text-sm text-muted">No levels configured yet.</p>}
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Add a custom level</h3>
            <div className="mt-3">
              <AddLevelForm organizationId={selectedOrg.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
