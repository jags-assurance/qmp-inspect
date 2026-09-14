import { requireSession, canSeePlatformHome, isAdminStaff } from "@/lib/auth/session";
import { AppShell, type NavItem } from "@/components/domain/app-shell";

export default async function InspectLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

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
          { label: "Reporting", href: "/inspect/organisation/reporting" },
          { label: "Staff Access", href: "/inspect/organisation/staff-access" },
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
