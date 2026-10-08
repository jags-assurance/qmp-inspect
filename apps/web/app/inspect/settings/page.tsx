import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { SettingsNav, SettingsSkeleton, type SettingsNavGroup } from "./settings-nav";
import { ClientOrganisationsView } from "../organisation/clients/clients-view";
import { ClientTeamsView } from "../organisation/client-teams/client-teams-view";
import { ChecklistLibraryView } from "../organisation/checklist-library/checklist-library-view";
import { StaffAccessView } from "../organisation/staff-access/staff-access-view";
import { CustomRolesView } from "../organisation/roles/roles-view";
import { TeamsView } from "../organisation/teams/teams-view";
import { ModuleLicensingSettingsView } from "../organisation/module-licensing/module-licensing-view";
import { NumberingSettingsView } from "../organisation/numbering/numbering-view";
import { BrandingSettingsView } from "../organisation/branding/branding-view";
import { AutomationRulesView } from "../organisation/automation/automation-view";
import { PortfolioInsightsView } from "../organisation/insights/insights-view";
import { ReportingView } from "../organisation/reporting/reporting-view";
import { CloudFolderSyncView } from "../organisation/cloud-sync/cloud-sync-view";
import { InterventionLevelsSettingsView } from "../organisation/intervention-levels/intervention-levels-view";
import { PlansSettingsView } from "../organisation/plans/plans-view";
import { RetentionSettingsView } from "../organisation/retention/retention-view";

export const metadata: Metadata = { title: "Settings" };

const DESCRIPTIONS: Record<string, string> = {
  clients: "Companies you work for, and their projects.",
  "client-teams": "Group a client's people into teams.",
  "checklist-library": "Reusable checklist items for ITPs.",
  "staff-access": "Who on your staff can sign in, and what they can do.",
  roles: "Define custom roles and their permissions.",
  teams: "Staff teams and their leads.",
  "module-licensing": "Switch features on or off per organisation.",
  numbering: "How ITP, NCR and IRN numbers are generated.",
  branding: "Logo and colours shown to your organisation.",
  automation: "Rules that act automatically, such as reminders.",
  insights: "Cross-project quality trends.",
  reporting: "Scheduled and on-demand report settings.",
  "cloud-sync": "Mirror documents to a cloud folder.",
  "intervention-levels": "Hold, witness and review level definitions.",
  plans: "Plan limits and seats in use.",
  retention: "How long documents are kept, and the ones past that period.",
};

type Params = Record<string, string | string[] | undefined>;
type Render = (sp: Params) => ReactNode;

// Each view takes its own narrow searchParams shape (`{ org?: string }` etc.); the workspace hands
// every view the same pass-through bag, so cast at the boundary.
const asView = (sp: Params) => sp as never;

const RENDERERS: Record<string, Render> = {
  clients: () => <ClientOrganisationsView embedded />,
  "client-teams": (sp) => <ClientTeamsView searchParams={asView(sp)} embedded />,
  "checklist-library": () => <ChecklistLibraryView embedded />,
  "staff-access": () => <StaffAccessView embedded />,
  roles: () => <CustomRolesView embedded />,
  teams: () => <TeamsView embedded />,
  "module-licensing": (sp) => <ModuleLicensingSettingsView searchParams={asView(sp)} embedded />,
  numbering: (sp) => <NumberingSettingsView searchParams={asView(sp)} embedded />,
  branding: (sp) => <BrandingSettingsView searchParams={asView(sp)} embedded />,
  automation: (sp) => <AutomationRulesView searchParams={asView(sp)} embedded />,
  insights: () => <PortfolioInsightsView embedded />,
  reporting: (sp) => <ReportingView searchParams={asView(sp)} embedded />,
  "cloud-sync": (sp) => <CloudFolderSyncView searchParams={asView(sp)} embedded />,
  "intervention-levels": (sp) => <InterventionLevelsSettingsView searchParams={asView(sp)} embedded />,
  plans: () => <PlansSettingsView embedded />,
  retention: (sp) => <RetentionSettingsView searchParams={asView(sp)} embedded />,
};

/** Same grouping as the admin "Settings" tree in app/inspect/layout.tsx. Items with `href` are link-only. */
const ALL_GROUPS: SettingsNavGroup[] = [
  {
    label: "Client Management",
    items: [
      { key: "clients", label: "Client Organisations" },
      { key: "client-teams", label: "Client Teams" },
    ],
  },
  {
    label: "Libraries",
    items: [
      { key: "checklist-library", label: "Checklist Library" },
      { key: "itp-master", label: "Master ITP Library", href: "/inspect/itp-master" },
    ],
  },
  {
    label: "Access & Roles",
    items: [
      { key: "staff-access", label: "Staff Access" },
      { key: "roles", label: "Custom Roles" },
      { key: "teams", label: "Teams" },
      { key: "module-licensing", label: "Module Licensing" },
    ],
  },
  {
    label: "Numbering & Branding",
    items: [
      { key: "numbering", label: "Numbering" },
      { key: "branding", label: "Brand Colors" },
      { key: "automation", label: "Automation Rules" },
    ],
  },
  {
    label: "Insights & Usage",
    items: [
      { key: "insights", label: "Portfolio Insights" },
      { key: "usage", label: "Usage & Cost", href: "/inspect/organisation/usage" },
      { key: "reporting", label: "Reporting" },
    ],
  },
  {
    label: "Sync & Traceability",
    items: [
      { key: "cloud-sync", label: "Cloud Folder Sync" },
      { key: "traceability", label: "Document Traceability", href: "/inspect/organisation/traceability" },
      { key: "intervention-levels", label: "Intervention Levels" },
      { key: "plans", label: "Plans & Seats" },
      { key: "retention", label: "Document Retention" },
      { key: "root-causes", label: "NCR Root Causes", href: "/inspect/organisation/root-causes" },
    ],
  },
];

/** Which section keys this login can already reach today — mirrors the nav gating in layout.tsx. */
async function visibleKeys(): Promise<Set<string> | "all"> {
  const session = await requireSession();
  if (isAdminStaff(session)) return "all";

  const supabase = await createSupabaseServerClient();
  const keys = new Set<string>();
  const showTeamsNav = session.isJagsStaff && (await isLeadOfAnyTeam(supabase, session.userId));
  if (showTeamsNav) keys.add("teams");

  const ownOrgId = session.isJagsStaff ? null : session.grants.find((g) => g.organization_id)?.organization_id ?? null;
  let showClientTeamsNav = session.isJagsStaff;
  let isSelfManagedOrg = false;
  if (!showClientTeamsNav && ownOrgId) {
    const [{ count }, { data: org }] = await Promise.all([
      supabase.from("client_teams").select("id", { count: "exact", head: true }).eq("organization_id", ownOrgId),
      supabase.from("organizations").select("engagement_scope").eq("id", ownOrgId).maybeSingle(),
    ]);
    isSelfManagedOrg = org?.engagement_scope === "self_managed" || org?.engagement_scope === "client_managed";
    showClientTeamsNav = (count ?? 0) > 0 || isSelfManagedOrg;
  }
  const [clientTeamsLicensed, customRolesLicensed] = ownOrgId
    ? await Promise.all([
        isModuleLicensed(supabase, ownOrgId, "client_teams"),
        isModuleLicensed(supabase, ownOrgId, "custom_roles"),
      ])
    : [true, true];

  if (showClientTeamsNav && clientTeamsLicensed) keys.add("client-teams");
  if (isSelfManagedOrg) {
    keys.add("numbering");
    keys.add("branding");
    if (customRolesLicensed) keys.add("roles");
  }
  return keys;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const visible = await visibleKeys();

  const groups = ALL_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => (visible === "all" ? true : !i.href && visible.has(i.key))),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0) redirect("/inspect");

  const rendered = groups.flatMap((g) => g.items).filter((i) => !i.href);
  const requested = typeof params.section === "string" ? params.section : undefined;
  const current = rendered.find((i) => i.key === requested) ?? rendered[0];
  if (!current) redirect("/inspect");

  // Pass every other param (org picker etc.) through to the view; `section` is ours.
  const { section: _section, ...viewParams } = params;
  void _section;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        {DESCRIPTIONS[current.key] ?? "Manage your organisation."} Use the menu to switch section.
      </p>
      <div className="lg:flex lg:gap-8">
        <SettingsNav groups={groups} active={current.key} />
        <section className="mt-6 min-w-0 flex-1 lg:mt-6" aria-label={current.label}>
          <Suspense key={current.key} fallback={<SettingsSkeleton />}>
            {RENDERERS[current.key](viewParams)}
          </Suspense>
        </section>
      </div>
    </div>
  );
}
