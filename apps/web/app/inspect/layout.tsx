import { requireSession, canSeePlatformHome, isAdminStaff } from "@/lib/auth/session";
import { AppShell, type NavItem } from "@/components/domain/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import type { ModuleKey } from "@/lib/module-licensing/types";

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
    isSelfManagedOrg = org?.engagement_scope === "self_managed";
    showClientTeamsNav = (clientTeamCount ?? 0) > 0 || isSelfManagedOrg;
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
    ...(session.isJagsStaff ? [{ label: "Start work", href: "/inspect/start-work" }] : []),
    { label: "Projects", href: "/inspect/projects" },
    ...(isLicensed("itps") ? [{ label: "ITPs", href: "/inspect/itps" }] : []),
    ...(isLicensed("ncrs") ? [{ label: "NCRs", href: "/inspect/ncrs" }] : []),
    ...(isLicensed("observations") ? [{ label: "Observations", href: "/inspect/observations" }] : []),
    ...(!isClientRole && isLicensed("standalone_assignments")
      ? [{ label: "Standalone Assignments", href: "/inspect/standalone" }]
      : []),
    ...(isLicensed("vault") ? [{ label: "Document Vault", href: "/inspect/vault" }] : []),
    ...((session.isJagsStaff || isClientRole) && isLicensed("handover")
      ? [{ label: "Handover", href: "/inspect/handover" }]
      : []),
    // Master library review and numbering/engagement settings are the Admin's job — an Inspector
    // gets the same operational nav a client sees, plus staff-wide screens (Projects/ITPs/etc.
    // above already show every organisation to any JAGS staff login, admin or inspector alike).
    ...(isAdminStaff(session)
      ? [
          { label: "Client Organisations", href: "/inspect/organisation/clients" },
          { label: "Master ITP Library", href: "/inspect/itp-master" },
          { label: "Checklist Library", href: "/inspect/organisation/checklist-library" },
          { label: "Numbering", href: "/inspect/organisation/numbering" },
          { label: "Intervention Levels", href: "/inspect/organisation/intervention-levels" },
          { label: "Brand Colors", href: "/inspect/organisation/branding" },
          { label: "Plans & Seats", href: "/inspect/organisation/plans" },
          { label: "Portfolio Insights", href: "/inspect/organisation/insights" },
          { label: "Usage & Cost", href: "/inspect/organisation/usage" },
          { label: "Reporting", href: "/inspect/organisation/reporting" },
          { label: "Staff Access", href: "/inspect/organisation/staff-access" },
          { label: "Teams", href: "/inspect/organisation/teams" },
          { label: "Client Teams", href: "/inspect/organisation/client-teams" },
          { label: "Custom Roles", href: "/inspect/organisation/roles" },
          { label: "Module Licensing", href: "/inspect/organisation/module-licensing" },
        ]
      : []),
    ...(showTeamsNav && !isAdminStaff(session)
      ? [{ label: "Teams", href: "/inspect/organisation/teams" }]
      : []),
    ...(showClientTeamsNav && !isAdminStaff(session) && isLicensed("client_teams")
      ? [{ label: "Client Teams", href: "/inspect/organisation/client-teams" }]
      : []),
    ...(isSelfManagedOrg && !isAdminStaff(session)
      ? [
          { label: "Manage", href: "/inspect/manage" },
          { label: "Numbering", href: "/inspect/organisation/numbering" },
          { label: "Brand Colors", href: "/inspect/organisation/branding" },
          ...(isLicensed("custom_roles") ? [{ label: "Custom Roles", href: "/inspect/organisation/roles" }] : []),
        ]
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
    >
      {children}
    </AppShell>
  );
}
