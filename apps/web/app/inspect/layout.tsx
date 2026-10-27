import { requireSession, canSeePlatformHome, isAdminStaff } from "@/lib/auth/session";
import { mfaEnabled } from "@/lib/auth/mfa";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n/direction";
import { localizeNavItems } from "@/lib/i18n/dictionary";
import { loadTermOverrides } from "@/lib/terminology/load";
import type { TermOverrides } from "@/lib/terminology/terms";
import { applyTerms } from "@/lib/terminology/terms";
import { TermsProvider } from "@/lib/terminology/terms-context";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { AppShell, type NavItem } from "@/components/domain/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";
import { getLicenseMap } from "@/lib/module-licensing/access";
import { isLicensedIn } from "@/lib/module-licensing/license-map";
import { loadOrgChrome } from "@/lib/organizations/chrome-cache";
import type { ModuleKey } from "@/lib/module-licensing/types";
import { brandComboColors } from "@/lib/branding/org-brand";
import { ACTIVE_ORG_COOKIE, grantedOrgIds, resolveActiveOrgId } from "@/lib/organizations/active-org";
import { loadNeedsTermsAcceptance } from "@/lib/terms/load";
import { ACTIVE_PROJECT_COOKIE, resolveActiveProjectId } from "@/lib/projects/active-project";
import { loadHeaderProjectOptions } from "@/lib/ui/header-projects";

/** Applies the admin's terminology overrides to nav labels (adds displayLabel; the English label stays the icon key). */
function applyTermsToNav(items: NavItem[], overrides: TermOverrides): NavItem[] {
  if (Object.keys(overrides).length === 0) return items;
  return items.map((item) => ({
    ...item,
    displayLabel: applyTerms(item.displayLabel ?? item.label, overrides),
    ...(item.children ? { children: applyTermsToNav(item.children, overrides) } : {}),
    ...(item.palette ? { palette: applyTermsToNav(item.palette, overrides) } : {}),
  }));
}

export default async function InspectLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // "own org" for a non-staff login, same lookup used everywhere else in this file/app
  // (client-teams/page.tsx, manage/page.tsx) — a non-staff user's access_grants are in practice all
  // scoped to the one org they belong to, so the first organization_id-bearing grant is that org.
  // A user with grants in several organisations can pick one (header switcher; the cookie is validated
  // against the user's own grants); the default stays the first grant.
  const cookieStore = await cookies();
  const ownOrgId = session.isJagsStaff ? null : resolveActiveOrgId(session.grants, cookieStore.get(ACTIVE_ORG_COOKIE)?.value);
  const grantedOrgs = session.isJagsStaff ? [] : grantedOrgIds(session.grants);
  const orgNamesPromise =
    grantedOrgs.length > 1
      ? supabase.from("organizations").select("id, name").in("id", grantedOrgs).returns<{ id: string; name: string }[]>()
      : Promise.resolve(null);

  // D-05: these lookups are independent of each other (none consumes another's result), so they all
  // start now instead of as four-plus serial round trips on the critical path of every navigation.
  //  - Teams is visible to a JAGS Admin (manages every team) or any staff account that leads at
  //    least one team; the extra query only happens for non-admin staff.
  //  - A client login with a definite own org needs: its client-team count (live), its organisation
  //    chrome (engagement mode/scope, branding colours, signed logo URL — D-07 cached, tagged and
  //    invalidated by the branding/numbering actions) and its module licences (D-07: ONE cached
  //    per-org map instead of one query per module).
  const [teamLeadResult, clientTeamCountResult, orgChrome, licenseMap, needsTerms, projectOptions, termOverrides] = await Promise.all([
    session.isJagsStaff && !isAdminStaff(session) ? isLeadOfAnyTeam(supabase, session.userId) : Promise.resolve(false),
    ownOrgId && !session.isJagsStaff
      ? supabase.from("client_teams").select("id", { count: "exact", head: true }).eq("organization_id", ownOrgId)
      : Promise.resolve(null),
    ownOrgId ? loadOrgChrome(supabase, ownOrgId) : Promise.resolve(null),
    ownOrgId ? getLicenseMap(supabase, ownOrgId) : Promise.resolve(null),
    // U7: false (no banner) until migration 20261128000100 is applied or on any error.
    loadNeedsTermsAcceptance(supabase, session.userId),
    // Header project selector: every project this login can see (RLS-scoped), capped at 400, deduped per
    // request (lib/ui/header-projects.ts); a portfolio beyond the cap still has each page's own filter.
    loadHeaderProjectOptions(session.userId),
    loadTermOverrides(),
  ]);
  const showTeamsNav = session.isJagsStaff && (isAdminStaff(session) || teamLeadResult === true);

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
    const scope = orgChrome?.row.engagement_scope;
    isSelfManagedOrg = scope === "self_managed" || scope === "client_managed";
    showClientTeamsNav = (clientTeamCountResult?.count ?? 0) > 0 || isSelfManagedOrg;
  }

  // Reqs R113-R118: engagement_mode already drives document numbering (lib/numbering/generate.ts's
  // internalReference) — this is the same signal driving visual branding in the app chrome. Only
  // looked up for a user with a definite own-org context (a client login); JAGS staff move across
  // every organisation's data, so their chrome always stays JAGS-only, same as today.
  const orgBranding: { engagementMode: string; logoUrl: string | null; brandCombo: string[] | null } | null = orgChrome
    ? { engagementMode: orgChrome.row.engagement_mode, logoUrl: orgChrome.logoUrl, brandCombo: brandComboColors(orgChrome.row) }
    : null;

  // R112 module licensing (layout-level): every nav item below that corresponds directly to a real
  // module_key is checked against `ownOrgId`'s licenses and dropped from the nav when explicitly
  // unlicensed. This is layout-level (rather than per-page redirects, like the project-scoped
  // Registers/Data Book/Reports pages use — see those pages' own doc comments) because every one of
  // these items is a TOP-LEVEL nav destination for a single, unambiguous org: a non-staff login's
  // own org, resolved once via ownOrgId above. JAGS staff always bypass entirely (the map is only
  // ever loaded for a non-staff session with a resolvable own org) — they need to see every module
  // to support any client. Fails open (see lib/module-licensing/access.ts) so a query error never
  // hides a nav item nobody explicitly unlicensed; a null map (cache unavailable) reads as licensed.
  const isLicensed = (key: ModuleKey) => isLicensedIn(licenseMap, key);

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

  // Grouped to follow the real QA workflow: Plan, Execute, Quality, Records, Admin.
  const navItems: NavItem[] = [
    ...(canSeePlatformHome(session)
      ? [{ label: "← JAGS Assurance", href: "/platform" }]
      : []),
    {
      label: "Dashboard",
      href: "/inspect",
      // Ctrl+K-only destinations that have no sidebar row of their own. Handover keeps the client /
      // staff + licence rule (not offered to contractors or TPI); Punch list is per-project, so its
      // entry point opens the project picker (no generic punch or registers route exists).
      palette: [
        { label: "Notifications", href: "/inspect/notifications" },
        ...((session.isJagsStaff || isClientRole) && isLicensed("handover")
          ? [{ label: "Data Book / Handover", href: "/inspect/handover" }]
          : []),
        { label: "Punch list (choose a project)", href: "/inspect/projects" },
        { label: "Registers: materials, calibration, plant (choose a project)", href: "/inspect/projects" },
        { label: "Data Book (choose a project)", href: "/inspect/reports-documents" },
        { label: "Reports (choose a project)", href: "/inspect/reports-documents" },
        { label: "NCR register", href: "/inspect/ncrs" },
        { label: "Observations register", href: "/inspect/observations" },
        { label: "Inspections list", href: "/inspect/inspections" },
      ],
    },
    ...(session.isJagsStaff ? [{ label: "Workflow", href: "/inspect/journey", group: "Plan" }] : []),
    { label: "Projects", href: "/inspect/projects", group: "Plan" },
    ...(isLicensed("itps") ? [{ label: "ITPs", href: "/inspect/itps", group: "Plan" }] : []),
    // Site work: for JAGS staff, Start work, Inspections and Standalone assignments are ONE sidebar entry
    // (the "Related pages" strip on each page moves between them in one tap); every address is unchanged.
    // Other roles keep the plain Inspections / Standalone rows.
    ...(session.isJagsStaff
      ? [
          {
            label: "Site work",
            href: "/inspect/start-work",
            group: "Execute",
            activePrefixes: ["/inspect/inspections", "/inspect/standalone"],
            palette: [
              { label: "Inspections", href: "/inspect/inspections" },
              ...(!isClientRole && isLicensed("standalone_assignments")
                ? [{ label: "Standalone Assignments", href: "/inspect/standalone" }]
                : []),
            ],
          },
        ]
      : [
          { label: "Inspections", href: "/inspect/inspections", group: "Execute" },
          ...(!isClientRole && isLicensed("standalone_assignments")
            ? [{ label: "Standalone Assignments", href: "/inspect/standalone", group: "Execute" }]
            : []),
        ]),
    // Issues: NCRs and Observations are the same records (an Observation is an NCR of severity "observation"),
    // so when both are available they share one sidebar entry; the strip switches between the two registers.
    ...(isLicensed("ncrs") && isLicensed("observations")
      ? [
          {
            label: "NCRs & Observations",
            href: "/inspect/ncrs",
            group: "Quality",
            activePrefixes: ["/inspect/observations"],
            palette: [{ label: "Observations register", href: "/inspect/observations" }],
          },
        ]
      : [
          ...(isLicensed("ncrs") ? [{ label: "NCRs", href: "/inspect/ncrs", group: "Quality" }] : []),
          ...(isLicensed("observations")
            ? [{ label: "Observations", href: "/inspect/observations", group: "Quality" }]
            : []),
        ]),
    // Per-project pages (Reports, Data Book, Activity, KPIs) are reached through this index.
    { label: "Reports & Documents", href: "/inspect/reports-documents", group: "Records" },
    ...(isLicensed("vault") ? [{ label: "Document Vault", href: "/inspect/vault", group: "Records" }] : []),
    { label: "Guide", href: "/inspect/guide", group: "Help" },
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
            group: "Admin",
            activePrefixes: ["/inspect/organisation", "/inspect/itp-master"],
            palette: [
              { label: "Client Organisations", href: "/inspect/settings?section=clients" },
              { label: "Client Teams", href: "/inspect/settings?section=client-teams" },
              { label: "Master ITP Library", href: "/inspect/itp-master" },
              { label: "Checklist Library", href: "/inspect/settings?section=checklist-library" },
              { label: "Staff Access", href: "/inspect/settings?section=staff-access" },
              { label: "Custom Roles", href: "/inspect/settings?section=roles" },
              { label: "Teams", href: "/inspect/settings?section=teams" },
              { label: "Module Licensing", href: "/inspect/settings?section=module-licensing" },
              { label: "Data Requests", href: "/inspect/settings?section=data-requests" },
              { label: "Numbering", href: "/inspect/settings?section=numbering" },
              { label: "Brand Colors", href: "/inspect/settings?section=branding" },
              { label: "Automation Rules", href: "/inspect/settings?section=automation" },
              { label: "Portfolio Insights", href: "/inspect/settings?section=insights" },
              { label: "Usage & Cost", href: "/inspect/settings?section=usage" },
              { label: "Reporting", href: "/inspect/settings?section=reporting" },
              { label: "System Health", href: "/inspect/settings?section=system-health" },
              { label: "Document Traceability", href: "/inspect/settings?section=traceability" },
              { label: "Terminology", href: "/inspect/settings?section=terminology" },
              { label: "Intervention Levels", href: "/inspect/settings?section=intervention-levels" },
              { label: "Plans & Seats", href: "/inspect/settings?section=plans" },
              { label: "Document Retention", href: "/inspect/settings?section=retention" },
              { label: "NCR Root Causes", href: "/inspect/settings?section=root-causes" },
              { label: "Orphaned Photos", href: "/inspect/settings?section=orphan-photos" },
            ],
          },
        ]
      : []),
    ...(showTeamsNav && !isAdminStaff(session)
      ? [{ label: "Teams", href: "/inspect/organisation/teams", group: "Admin" }]
      : []),
    // A self-/client-managed org's own admin gets the same "Settings" shape a JAGS Admin has,
    // instead of four-to-five flat top-level items competing with Projects/ITPs/NCRs. A client that
    // doesn't manage its own org keeps the single flat Client Teams link (when it has one).
    ...(isSelfManagedOrg && !isAdminStaff(session)
      ? [
          { label: "Manage", href: "/inspect/manage", group: "Admin" },
          {
            label: "Settings",
            href: "/inspect/settings",
            group: "Admin",
            activePrefixes: ["/inspect/organisation", "/inspect/manage"],
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
        ? [{ label: "Client Teams", href: "/inspect/organisation/client-teams", group: "Admin" }]
        : []),
  ];

  const grant = session.grants[0];
  const userRole = session.isJagsStaff
    ? isAdminStaff(session)
      ? "JAGS Admin"
      : "JAGS Field Engineer"
    : (grant?.role ?? "Member");

  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const orgNames = (await orgNamesPromise)?.data ?? [];
  const orgSwitcher =
    grantedOrgs.length > 1
      ? { options: grantedOrgs.map((id) => ({ id, name: orgNames.find((o) => o.id === id)?.name ?? "Organisation" })), activeId: ownOrgId }
      : null;
  const activeProjectId = resolveActiveProjectId(
    projectOptions.map((p) => p.id),
    cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value
  );
  return (
    <AppShell
      navItems={applyTermsToNav(localizeNavItems(navItems, locale), termOverrides)}
      userId={session.userId}
      userName={session.fullName}
      userEmail={session.email}
      userRole={applyTerms(userRole, termOverrides)}
      breadcrumb="QMP Inspect"
      orgBranding={orgBranding}
      showTermsBanner={needsTerms}
      orgSwitcher={orgSwitcher}
      projectSelector={projectOptions.length > 0 ? { options: projectOptions, activeId: activeProjectId } : null}
      userMenuLinks={[
        { label: "Dashboard", href: "/inspect" },
        ...(isAdminStaff(session) ? [{ label: "Settings", href: "/inspect/settings" }] : []),
        { label: "Guide", href: "/inspect/guide" },
        { label: "Help and support", href: "/inspect/support" },
        { label: "What's new", href: "/inspect/whats-new" },
        ...(mfaEnabled() ? [{ label: "Account security", href: "/inspect/account/security" }] : []),
      ]}
    >
      <TermsProvider overrides={termOverrides}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </TermsProvider>
    </AppShell>
  );
}
