import { requireSession, canSeePlatformHome, isAdminStaff } from "@/lib/auth/session";
import { AppShell, type NavItem } from "@/components/domain/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import type { ModuleKey } from "@/lib/module-licensing/types";
import { brandComboColors } from "@/lib/branding/org-brand";

export default async function InspectLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Teams is visible to a JAGS Admin (manages every team) or any staff account that leads at least
  // one team (manages only their own) — an Inspector with no lead role has no reason to see it.
  // Admin already implies this, so the extra DB round-trip only happens for non-admin staff.
  const showTeamsNav = session.isJagsStaff && (isAdminStaff(session) || (await isLeadOfAnyTeam(supabase, session.userId)));

  // R112 module licensing: "own org" for a non-staff login, same lookup used everywhere else in
  // this file/app (client-teams/page.tsx, manage/page.tsx) — a non-staff user's access_grants are
  // in practice all scoped to the one org they belong to, so the first organization_id-bearing grant
  // is that org. Computed once here, hoisted above the Client Teams block below since both need it.
  const ownOrgId = session.isJagsStaff ? null : session.grants.find((g) => g.organization_id)?.organization_id ?? null;

  // Client Teams (a client org's OWN people grouping — see app/inspect/organisation/client-teams,
  // supabase/migrations/20260919020000_client_teams.sql) is always visible to staff (an Admin can
  // browse any org's client teams; an Inspector can at least view them, matching how Teams itself is
  // gated). A non-staff client user only gets the link if it would actually show them something: their
  // own org already has at least one client_team, or their org is self_managed (so they can bootstrap
  // the first one) — avoids dangling an empty/irrelevant nav item in front of, say, a subcontractor or
  // TPI login that will never have a client team of its own.
  let showClientTeamsNav = session.isJagsStaff;
  // Numbering (numbering-only view), Brand Colors, and Custom Roles are all self-service for a
  // Self-Managed client's own organization (20260919050000_self_managed_org_settings.sql,
  // 20260919030000_self_managed_custom_role_management.sql) — "the client manages its own
  // organization." Computed once here alongside the Client Teams check since they share the same
  // "is my own org self_managed" lookup.
  let isSelfManagedOrg = false;
  if (!showClientTeamsNav && ownOrgId) {
    const [{ count: clientTeamCount }, { data: org }] = await Promise.all([
      supabase.from("client_teams").select("id", { count: "exact", head: true }).eq("organization_id", ownOrgId),
      supabase.from("organizations").select("engagement_scope").eq("id", ownOrgId).maybeSingle(),
    ]);
    isSelfManagedOrg = org?.engagement_scope === "self_managed" || org?.engagement_scope === "client_managed";
    showClientTeamsNav = (clientTeamCount ?? 0) > 0 || isSelfManagedOrg;
  }

  // Reqs R113-R118: engagement_mode already drives document numbering (lib/numbering/generate.ts's
  // internalReference) — this is the same signal driving visual branding in the app chrome. Only
  // looked up for a user with a definite own-org context (a client login); JAGS staff move across
  // every organisation's data, so their chrome always stays JAGS-only, same as today.
  let orgBranding: { engagementMode: string; logoUrl: string | null; brandCombo: string[] | null } | null = null;
  if (ownOrgId) {
    const { data: brandOrg } = await supabase
      .from("organizations")
      .select(
        "engagement_mode, branding_logo_path, brand_primary_color, brand_accent_color, brand_extra_colors, brand_multi_color_mode"
      )
      .eq("id", ownOrgId)
      .maybeSingle<{
        engagement_mode: string;
        branding_logo_path: string | null;
        brand_primary_color: string | null;
        brand_accent_color: string | null;
        brand_extra_colors: string[];
        brand_multi_color_mode: boolean;
      }>();

    if (brandOrg) {
      let logoUrl: string | null = null;
      if (brandOrg.engagement_mode !== "jags_led" && brandOrg.branding_logo_path) {
        const { data: signed } = await supabase.storage
          .from("org-branding")
          .createSignedUrl(brandOrg.branding_logo_path, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }
      orgBranding = { engagementMode: brandOrg.engagement_mode, logoUrl, brandCombo: brandComboColors(brandOrg) };
    }
  }

  // R112 module licensing (layout-level): every nav item below that corresponds directly to a real
  // module_key is checked against `ownOrgId`'s licenses and dropped from the nav when explicitly
  // unlicensed. This is layout-level (rather than per-page redirects, like the project-scoped
  // Registers/Data Book/Reports pages use — see those pages' own doc comments) because every one of
  // these items is a TOP-LEVEL nav destination for a single, unambiguous org: a non-staff login's
  // own org, resolved once via ownOrgId above. JAGS staff always bypass entirely (isModuleLicensed
  // is only even called for a non-staff session with a resolvable own org) — they need to see every
  // module to support any client. Fails open (see lib/module-licensing/access.ts) so a query error
  // never hides a nav item nobody explicitly unlicensed.
  const licensedModules = new Map<ModuleKey, boolean>();
  if (ownOrgId) {
    const keysToCheck: ModuleKey[] = [
      "itps",
      "ncrs",
      "observations",
      "vault",
      "standalone_assignments",
      "handover",
      "client_teams",
      "custom_roles",
    ];
    const results = await Promise.all(keysToCheck.map((key) => isModuleLicensed(supabase, ownOrgId, key)));
    keysToCheck.forEach((key, i) => licensedModules.set(key, results[i]));
  }
  const isLicensed = (key: ModuleKey) => licensedModules.get(key) ?? true;

  // Every non-staff role used to get the identical nav, with only the underlying data differing
  // via RLS — no portal actually looked or felt different per party. This is a first, deliberately
  // conservative pass at real per-role navigation (full separate page sets would be a much bigger
  // change): Handover is the client's own acknowledgment portal (see acknowledge-form.tsx's own
  // comment — "the client's own action on their own handover package"), so it has no reason to
  // appear for a subcontractor/main contractor/TPI login. Standalone/FAT assignments are JAGS-run
  // field work (execution is staff-only as of this session's fixes) that a client has no direct
  // reason to navigate to, but a subcontractor/contractor/TPI directly involved in a witnessed test
  // still does.
  const isClientRole = !session.isJagsStaff && session.grants.some((g) => g.role === "client");

  const navItems: NavItem[] = [
    ...(canSeePlatformHome(session)
      ? [{ label: "← JAGS Assurance", href: "/platform" }]
      : []),
    { label: "Dashboard", href: "/inspect" },
    { label: "Guide", href: "/inspect/guide" },
    ...(session.isJagsStaff ? [{ label: "Start work", href: "/inspect/start-work" }] : []),
    { label: "Projects", href: "/inspect/projects" },
    // Reports & Downloads / Data Book / Activity / KPIs are all per-project pages — no single
    // top-level href makes sense for them without a project already chosen. This is a dedicated
    // index page (the project filter lives there, not in the sidebar itself) that lists every
    // project this login can reach and links straight into that project's own four pages — same
    // "always visible, RLS decides what's actually in the list" pattern Projects itself already
    // uses, not gated on any module license since it's purely a navigational aggregator.
    { label: "Reports & Documents", href: "/inspect/reports-documents" },
    ...(isLicensed("itps") ? [{ label: "ITPs", href: "/inspect/itps" }] : []),
    ...(isLicensed("ncrs") ? [{ label: "NCRs", href: "/inspect/ncrs" }] : []),
    ...(isLicensed("observations") ? [{ label: "Observations", href: "/inspect/observations" }] : []),
    ...(!isClientRole && isLicensed("standalone_assignments")
      ? [{ label: "Standalone Assignments", href: "/inspect/standalone" }]
      : []),
    ...(isLicensed("vault") ? [{ label: "Document Vault", href: "/inspect/vault" }] : []),
    // Handover used to be its own top-level nav item here — folded into "Reports & Documents"
    // instead (a handover certificate is itself a kind of report/document, and the two sitting
    // side by side in the sidebar was confusing/redundant). The route itself is unchanged
    // (/inspect/handover), just reached via a card on that page now instead of its own nav entry.
    // Master library review and numbering/engagement settings are the Admin's job — an Inspector
    // gets the same operational nav a client sees, plus staff-wide screens (Projects/ITPs/etc.
    // above already show every organisation to any JAGS staff login, admin or inspector alike).
    //
    // Previously one big collapsible "Organisation Settings" group holding all 17 items — better
    // than the original flat 26-item sidebar, but a single 17-row group is still a long list once
    // opened. Split into 6 smaller theme groups instead, so opening one only ever shows the 2-4
    // items actually related to what you're looking for. Every href below is unchanged from the
    // single-group version — this only changes how they're grouped.
    // Redesign (plan Phase 8): flatten the top-level nav further by folding all 6 admin theme
    // groups under one "Settings" entry, rather than 6 separate top-level group headers competing
    // with Projects/ITPs/NCRs for attention. No page moves or is deleted — every href below is
    // identical to the previous flat-group version, this only changes how the groups are reached
    // (Settings > theme group > page, instead of theme group > page directly in the sidebar).
    // One "Settings" entry for the whole organisation-settings area: it opens the tabbed Settings
    // workspace (/inspect/settings) where every section is a tab, instead of a three-level nested
    // sidebar group. Every section stays one Ctrl+K search away via `palette`.
    ...(isAdminStaff(session)
      ? [
          {
            label: "Settings",
            href: "/inspect/settings",
            palette: [
              { label: "Client Organisations", href: "/inspect/settings?section=clients" },
              { label: "Client Teams", href: "/inspect/settings?section=client-teams" },
              { label: "Master ITP Library", href: "/inspect/itp-master" },
              { label: "Checklist Library", href: "/inspect/settings?section=checklist-library" },
              { label: "Staff Access", href: "/inspect/settings?section=staff-access" },
              { label: "Custom Roles", href: "/inspect/settings?section=roles" },
              { label: "Teams", href: "/inspect/settings?section=teams" },
              { label: "Module Licensing", href: "/inspect/settings?section=module-licensing" },
              { label: "Numbering", href: "/inspect/settings?section=numbering" },
              { label: "Brand Colors", href: "/inspect/settings?section=branding" },
              { label: "Automation Rules", href: "/inspect/settings?section=automation" },
              { label: "Portfolio Insights", href: "/inspect/settings?section=insights" },
              { label: "Usage & Cost", href: "/inspect/organisation/usage" },
              { label: "Reporting", href: "/inspect/settings?section=reporting" },
              { label: "Cloud Folder Sync", href: "/inspect/settings?section=cloud-sync" },
              { label: "Document Traceability", href: "/inspect/organisation/traceability" },
              { label: "Intervention Levels", href: "/inspect/settings?section=intervention-levels" },
              { label: "Plans & Seats", href: "/inspect/settings?section=plans" },
            ],
          },
        ]
      : []),
    ...(showTeamsNav && !isAdminStaff(session)
      ? [{ label: "Teams", href: "/inspect/organisation/teams" }]
      : []),
    // A self-/client-managed org's own admin gets the same "Settings" shape a JAGS Admin has,
    // instead of four-to-five flat top-level items competing with Projects/ITPs/NCRs. A client that
    // doesn't manage its own org keeps the single flat Client Teams link (when it has one).
    ...(isSelfManagedOrg && !isAdminStaff(session)
      ? [
          { label: "Manage", href: "/inspect/manage" },
          {
            label: "Settings",
            href: "/inspect/settings",
            palette: [
              { label: "Manage", href: "/inspect/manage" },
              ...(showClientTeamsNav && isLicensed("client_teams")
                ? [{ label: "Client Teams", href: "/inspect/settings?section=client-teams" }]
                : []),
              { label: "Numbering", href: "/inspect/settings?section=numbering" },
              { label: "Brand Colors", href: "/inspect/settings?section=branding" },
              ...(isLicensed("custom_roles") ? [{ label: "Custom Roles", href: "/inspect/settings?section=roles" }] : []),
            ],
          },
        ]
      : showClientTeamsNav && !isAdminStaff(session) && isLicensed("client_teams")
        ? [{ label: "Client Teams", href: "/inspect/organisation/client-teams" }]
        : []),
  ];

  const grant = session.grants[0];
  const userRole = session.isJagsStaff
    ? isAdminStaff(session)
      ? "JAGS Admin"
      : "JAGS Inspector"
    : (grant?.role ?? "Member");

  return (
    <AppShell
      navItems={navItems}
      userId={session.userId}
      userName={session.fullName}
      userRole={userRole}
      breadcrumb="QMP Inspect"
      orgBranding={orgBranding}
    >
      {children}
    </AppShell>
  );
}
