import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AccessGrant {
  scope_type: "global" | "organization" | "project";
  organization_id: string | null;
  project_id: string | null;
  role: string;
}

export type StaffRole = "admin" | "inspector" | null;

export interface SessionContext {
  userId: string;
  email: string;
  fullName: string;
  isJagsStaff: boolean;
  /** Only meaningful when isJagsStaff is true. Null (legacy accounts, e.g. the original seeded
   *  admin) behaves as admin-equivalent — see isAdminStaff below. */
  staffRole: StaffRole;
  grants: AccessGrant[];
}

/**
 * Loads the current user's profile + access grants. Every field here is already RLS-scoped to
 * "what this user is allowed to see" — there is no separate permission check layered on top,
 * because the database is the permission check.
 *
 * Performance: wrapped in React's `cache()` (request-scoped memoization for Server
 * Components/Actions) because both `apps/web/app/inspect/layout.tsx` and every nested page call
 * `requireSession()`/`getSessionContext()` independently — before this, a single page load paid
 * for TWO full auth+DB round-trips (layout, then page again) on top of the middleware's own
 * `auth.getUser()` check, i.e. 3 separate auth validations per request. `cache()` collapses same-
 * request calls into one. The two DB queries below (`users`, `access_grants`) are also now fired
 * in parallel instead of sequentially — they're independent, so there's no reason to wait for one
 * before starting the other.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();

  // The proxy (proxy.ts) already validates this request's session against the Auth server with
  // getUser(). Here we only need to know WHO it is, so verify the JWT locally with getClaims()
  // (JWKS-cached, no network round-trip when the project uses asymmetric signing keys; it falls
  // back to a server check otherwise) instead of paying for a second Auth round-trip per request.
  // Every query below is still RLS-scoped to this user, which remains the real boundary.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;
  const user = { id: userId };

  const loadAccount = () =>
    Promise.all([
      supabase
        .from("users")
        .select("id, email, full_name, is_jags_staff, staff_role, is_active")
        .eq("id", user.id)
        .single<{
          id: string;
          email: string;
          full_name: string;
          is_jags_staff: boolean;
          staff_role: StaffRole;
          is_active: boolean | null;
        }>(),
      supabase
        .from("access_grants")
        .select("scope_type, organization_id, project_id, role")
        .eq("user_id", user.id)
        .returns<AccessGrant[]>(),
    ]);
  let [{ data: profile, error: profileError }, { data: grants, error: grantsError }] = await loadAccount();
  // One quick retry: a single slow or dropped read must not turn into "Something went wrong" on every page.
  if ((profileError && profileError.code !== "PGRST116") || grantsError) {
    await new Promise((r) => setTimeout(r, 400));
    [{ data: profile, error: profileError }, { data: grants, error: grantsError }] = await loadAccount();
  }

  // A failed read is not "signed out": returning null here sent valid users to
  // /login?error=session_ended whenever the database was slow (seen on dev under load), and an empty
  // grant list would hide every project from a staff user. Only a missing profile row means no session.
  if (profileError && profileError.code !== "PGRST116") throw new Error(`Could not load your account: ${profileError.message}`);
  if (grantsError) throw new Error(`Could not load your access grants: ${grantsError.message}`);
  if (!profile) return null;
  // A deactivated account has no session context (the RLS helpers already refuse it; this keeps the
  // UI from rendering a half-empty shell). proxy.ts also ends such a session.
  if (profile.is_active === false) return null;

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    isJagsStaff: profile.is_jags_staff,
    staffRole: profile.staff_role,
    grants: grants ?? [],
  };
});

/** Use in a Server Component/layout that requires a signed-in user; redirects to /login otherwise. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login?error=session_ended");
  return session;
}

/**
 * Only a JAGS Admin ever reaches the Platform Home — it exposes JAGS's own billing/module-licensing
 * /organisation settings, which neither external parties (client, contractor, subcontractor,
 * TPI/lab) nor an Inspector (operational, not account-administrative) have reason to see. Mirrors
 * the prototype, where "Maya Patel (Jags Admin)" and "Priya Nair (Senior Inspector)" had entirely
 * separate landing screens — an Inspector's is the Inspector Dashboard inside QMP Inspect directly,
 * never the Orbit hub.
 */
export function canSeePlatformHome(session: SessionContext): boolean {
  return isAdminStaff(session);
}

/**
 * Splits JAGS staff into two personas, matching the prototype's original design: an Admin (client
 * setup, project creation, numbering/engagement configuration, master-library approval — the
 * strategic/administrative side, typically a busy owner who delegates day-to-day work) versus an
 * Inspector (ITP activities, checklists, field inspections, NCRs, sign-offs — the operational side
 * that actually runs projects day to day). A null staff_role (the original seeded admin account,
 * created before this distinction existed) is treated as admin-equivalent so existing behavior
 * doesn't regress; only an account explicitly marked 'inspector' is restricted.
 */
export function isAdminStaff(session: SessionContext): boolean {
  return session.isJagsStaff && session.staffRole !== "inspector";
}
