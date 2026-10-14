import type { SessionContext } from "@/lib/auth/session";

/**
 * True when the caller holds a grant covering the WHOLE organisation (a global grant, or an
 * organization-scope grant on that org). A project-scoped grant does not count. Mirrors the
 * database function has_org_wide_access().
 */
export function holdsOrgWideGrant(session: Pick<SessionContext, "grants">, organizationId: string): boolean {
  return session.grants.some(
    (g) => g.scope_type === "global" || (g.scope_type === "organization" && g.organization_id === organizationId)
  );
}
