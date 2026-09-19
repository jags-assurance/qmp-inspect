import { requireSession, canSeePlatformHome, isAdminStaff } from "@/lib/auth/session";
import { AppShell, type NavItem } from "@/components/domain/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";

export default async function InspectLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Teams is visible to a JAGS Admin (manages every team) or any staff account that leads at least
  // one team (manages only their own) — an Inspector with no lead role has no reason to see it.
  // Admin already implies this, so the extra DB round-trip only happens for non-admin staff.
  const showTeamsNav = session.isJagsStaff && (isAdminStaff(session) || (await isLeadOfAnyTeam(supabase, session.userId)));

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
  if (!showClientTeamsNav) {
    const ownOrgId = session.grants.find((g) => g.organization_id)?.organization_id ?? null;
    if (ownOrgId) {
      const [{ count: clientTeamCount }, { data: org }] = await Promise.all([
        supabase.from("client_teams").select("id", { count: "exact", head: true }).eq("organization_id", ownOrgId),
        supabase.from("organizations").select("engagement_scope").eq("id", ownOrgId).maybeSingle(),
      ]);
      isSelfManagedOrg = org?.engagement_scope === "self_managed";
      showClientTeamsNav = (clientTeamCount ?? 0) > 0 || isSelfManagedOrg;
    }
  }

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
    { label: "ITPs", href: "/inspect/itps" },
    { label: "NCRs", href: "/inspect/ncrs" },
    { label: "Observations", href: "/inspect/observations" },
    ...(!isClientRole ? [{ label: "Standalone Assignments", href: "/inspect/standalone" }] : []),
    { label: "Document Vault", href: "/inspect/vault" },
    ...(session.isJagsStaff || isClientRole ? [{ label: "Handover", href: "/inspect/handover" }] : []),
    // Master library review and numbering/engagement settings are the Admin's job — an Inspector
    // gets the same operational nav a client sees, plus staff-wide screens (Projects/ITPs/etc.
    // above already show every organisation to any JAGS staff login, admin or inspector alike).
    ...(isAdminStaff(session)
      ? [
          { label: "Client Organisations", href: "/inspect/organisation/clients" },
          { label: "Master ITP Library", href: "/inspect/itp-master" },
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
        ]
      : []),
    ...(showTeamsNav && !isAdminStaff(session)
      ? [{ label: "Teams", href: "/inspect/organisation/teams" }]
      : []),
    ...(showClientTeamsNav && !isAdminStaff(session)
      ? [{ label: "Client Teams", href: "/inspect/organisation/client-teams" }]
      : []),
    ...(isSelfManagedOrg && !isAdminStaff(session)
      ? [
          { label: "Numbering", href: "/inspect/organisation/numbering" },
          { label: "Brand Colors", href: "/inspect/organisation/branding" },
          { label: "Custom Roles", href: "/inspect/organisation/roles" },
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
