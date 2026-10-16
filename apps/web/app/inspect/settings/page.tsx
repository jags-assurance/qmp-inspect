import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE, resolveActiveOrgId } from "@/lib/organizations/active-org";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { SettingsAreaTabs, SettingsLanding, SettingsSkeleton, type SettingsArea } from "./settings-nav";
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
import { SystemHealthView } from "../organisation/system-health/system-health-view";
import { DataRequestsView } from "../organisation/data-requests/page";
import { OrphanPhotosView } from "../organisation/orphan-photos/page";
import { DocumentTraceabilityView } from "../organisation/traceability/page";
import { UsageAndCostView } from "../organisation/usage/page";
import { RootCausesView } from "../organisation/root-causes/root-causes-view";
import { T } from "@/components/domain/t";
import { PageHeader } from "@/components/ui/page-header";

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
  "system-health": "Which features are configured, worker activity and email queue.",
  "data-requests": "Answer a person's request for a copy of their data, or for deletion.",
  "orphan-photos": "Photos uploaded but never linked to a record.",
  traceability: "Look up any ITP, NCR or inspection and see its full history.",
  usage: "AI and PDF usage with a cost estimate, last 30 days.",
  "root-causes": "The root-cause list used when closing NCRs.",
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
  "system-health": () => <SystemHealthView embedded />,
  "data-requests": (sp) => <DataRequestsView searchParams={asView(sp)} embedded />,
  "orphan-photos": () => <OrphanPhotosView embedded />,
  traceability: (sp) => <DocumentTraceabilityView searchParams={asView(sp)} embedded />,
  usage: (sp) => <UsageAndCostView searchParams={asView(sp)} embedded />,
  "root-causes": (sp) => <RootCausesView searchParams={asView(sp)} embedded />,
};

/**
 * Settings, in six plain-language areas. A person picks the job, then the section; related sections sit
 * together as tabs. Every section key and address is unchanged (?section=<key>); items with `href` open
 * their own page.
 */
const ALL_AREAS: SettingsArea[] = [
  {
    key: "people",
    label: "People & access",
    description: "Who can sign in, what each person can do, and how people are grouped into teams.",
    items: [
      { key: "staff-access", label: "Staff Access" },
      { key: "roles", label: "Custom Roles" },
      { key: "teams", label: "Teams" },
      { key: "client-teams", label: "Client Teams" },
    ],
  },
  {
    key: "clients",
    label: "Clients & plans",
    description: "The companies you work for, which features each one has, and their plan and seats.",
    items: [
      { key: "clients", label: "Client Organisations" },
      { key: "module-licensing", label: "Module Licensing" },
      { key: "plans", label: "Plans & Seats" },
    ],
  },
  {
    key: "templates",
    label: "Templates & standards",
    description: "The libraries, sign-off levels and root-cause lists your ITPs and checklists are built from.",
    items: [
      { key: "checklist-library", label: "Checklist Library" },
      { key: "itp-master", label: "Master ITP Library", href: "/inspect/itp-master" },
      { key: "intervention-levels", label: "Intervention Levels" },
      { key: "root-causes", label: "NCR Root Causes" },
    ],
  },
  {
    key: "look",
    label: "Numbering, look & automation",
    description: "How record numbers are made, your logo and colours, automatic reminders and reports.",
    items: [
      { key: "numbering", label: "Numbering" },
      { key: "branding", label: "Brand Colors" },
      { key: "automation", label: "Automation Rules" },
      { key: "reporting", label: "Reporting" },
    ],
  },
  {
    key: "insights",
    label: "Insights & health",
    description: "Quality trends, what the system costs to run, whether everything is working, and record lookups.",
    items: [
      { key: "insights", label: "Portfolio Insights" },
      { key: "usage", label: "Usage & Cost" },
      { key: "system-health", label: "System Health" },
      { key: "traceability", label: "Document Traceability" },
    ],
  },
  {
    key: "data",
    label: "Data & privacy",
    description: "How long documents are kept, requests about people's data, and uploaded photos nothing uses.",
    items: [
      { key: "retention", label: "Document Retention" },
      { key: "data-requests", label: "Data Requests" },
      { key: "orphan-photos", label: "Orphaned Photos" },
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

  const ownOrgId = session.isJagsStaff ? null : resolveActiveOrgId(session.grants, (await cookies()).get(ACTIVE_ORG_COOKIE)?.value);
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

  const areas = ALL_AREAS.map((a) => ({
    ...a,
    items: a.items.filter((i) => (visible === "all" ? true : !i.href && visible.has(i.key))),
  })).filter((a) => a.items.length > 0);
  if (areas.length === 0) redirect("/inspect");

  const rendered = areas.flatMap((a) => a.items).filter((i) => !i.href);
  const requested = typeof params.section === "string" ? params.section : undefined;
  // One area only: skip the front door and open its first section. Otherwise a missing or unknown
  // section shows the front door (the areas), not an arbitrary first section.
  const current = rendered.find((i) => i.key === requested) ?? (areas.length === 1 ? rendered[0] : undefined);
  if (!current && rendered.length === 0) redirect("/inspect");

  // Pass every other param (org picker etc.) through to the view; `section` is ours.
  const { section: _section, ...viewParams } = params;
  void _section;

  if (!current) {
    return (
      <div>
        <PageHeader className="mb-0" title={<T>Settings</T>} subtitle={<T>Choose what you want to manage.</T>} />
        <SettingsLanding areas={areas} />
      </div>
    );
  }
  const area = areas.find((a) => a.items.some((i) => i.key === current.key)) ?? areas[0];

  return (
    <div>
      <PageHeader
        className="mb-0"
        title={<T>Settings</T>}
        subtitle={DESCRIPTIONS[current.key] ?? "Manage your organisation."}
      />
      <SettingsAreaTabs area={area} active={current.key} showAllLink={areas.length > 1} />
      <section className="mt-6 min-w-0" aria-label={current.label}>
        <Suspense key={current.key} fallback={<SettingsSkeleton />}>
          {RENDERERS[current.key](viewParams)}
        </Suspense>
      </section>
    </div>
  );
}
