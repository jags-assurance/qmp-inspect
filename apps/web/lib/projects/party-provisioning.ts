"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { hasPermission } from "@/lib/rbac/permissions";

export interface ProvisionPartyLoginState {
  error: string | null;
  /** Only set once, right after a BRAND NEW account is created — the temporary password the admin
   *  needs to hand to that person out-of-band (this app sends no invite email of its own; see this
   *  file's header comment). Never logged, never written anywhere but this one response. When an
   *  existing JAGS Assurance account was linked instead, this is null — there is no new password to
   *  share, and nothing about that account changes. */
  tempPassword: string | null;
  /** The email this result is for, so the UI can show "Temporary password for jane@…" even after
   *  the form's own input has been cleared/revalidated. */
  email: string | null;
}

// Not exported: a "use server" file may only export async functions — see
// provision-party-login-form.tsx, which defines its own copy of this shape as every other
// useActionState initial-state constant in this app already does (e.g. reassign-party-form.tsx).
const INITIAL_STATE: ProvisionPartyLoginState = { error: null, tempPassword: null, email: null };

/**
 * A strong, single-use temporary password — 16 random bytes, base64url-encoded and trimmed to 22
 * characters, well past Supabase Auth's own minimum length. Never a fixed/shared "default password"
 * (that would be a real credential-stuffing risk the moment more than one org used this), never
 * reused across accounts, and never persisted anywhere in plain text beyond this one action's
 * return value — the admin who provisions the login is trusted to hand it to that person directly
 * (in person, over the phone, a password manager's share feature — whatever this org already uses
 * for that), the same way handing over any other one-time credential works.
 */
function generateTempPassword(): string {
  return randomBytes(16).toString("base64url").slice(0, 22);
}

/**
 * Closes the real gap behind "when I add parties, they can't access the platform by that email":
 * addProjectPartyAction (lib/projects/actions.ts) only ever stored a party's email as plain
 * contact_email text — no Supabase Auth account, no login, nothing. This is the missing step,
 * offered as its own explicit action (shown next to a party's "No linked login yet" state on the
 * project page) rather than folded into party creation itself, so a JAGS Admin can add a party
 * first and decide separately, per party, whether that party actually needs its own login (many
 * don't — JAGS staff can already act on any party's behalf).
 *
 * Two paths, exactly like addSelfManagedPartyAction's own split:
 *   1. An account for this email already exists (public.users, case-insensitively) → just link it
 *      (project_parties.user_id) and grant project access. No new credential, nothing to hand over.
 *   2. No account exists → create one via the Supabase Auth admin API with a random temporary
 *      password, flag it must_change_password so the next sign-in is forced through /reset-password
 *      before anywhere else (proxy.ts), then link + grant exactly as path 1.
 *
 * JAGS-Admin only, OR a custom "provision_party_login" RBAC grant on the party's project — this
 * calls the service-role auth admin API, which is a materially more sensitive capability than
 * anything else in projects/actions.ts (it can create real login credentials for anyone), so unlike
 * addProjectPartyAction's "add_project_party" grant, it is deliberately restricted to a permission
 * key that only a "Full Client-Managed" org's own role can ever be granted (see
 * CLIENT_MANAGED_ONLY_PERMISSION_KEYS) — never a plain self-managed ("Hybrid") org's.
 */
export async function provisionPartyLoginAction(
  _prev: ProvisionPartyLoginState,
  formData: FormData
): Promise<ProvisionPartyLoginState> {
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const emailInput = String(formData.get("email") ?? "").trim();

  if (!projectPartyId) return { ...INITIAL_STATE, error: "Missing party." };

  const session = await requireSession();

  if (!isServiceRoleConfigured()) {
    return {
      ...INITIAL_STATE,
      error: "Login provisioning isn't configured in this environment (SUPABASE_SERVICE_ROLE_KEY missing).",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { data: party } = await supabase
    .from("project_parties")
    .select("id, project_id, party_type, name, contact_name, contact_email, user_id, projects(organization_id)")
    .eq("id", projectPartyId)
    .maybeSingle<{
      id: string;
      project_id: string;
      party_type: string;
      name: string;
      contact_name: string | null;
      contact_email: string | null;
      user_id: string | null;
      projects: { organization_id: string } | null;
    }>();

  if (!party) return { ...INITIAL_STATE, error: "Party not found." };

  // JAGS Admin, always; OR — the "Full Client-Managed" tier's whole point — someone holding the
  // provision_party_login custom permission on this party's own project, which the RLS side
  // (project_parties_client_managed_provision, if/when the DB grant is added) would enforce anyway.
  // This app-layer check exists for a clear error message; hasPermission() is never the real gate.
  if (!isAdminStaff(session) && !(await hasPermission(session.userId, "provision_party_login", party.project_id))) {
    return { ...INITIAL_STATE, error: "Only a JAGS Admin (or someone granted this permission) can grant a party platform access." };
  }

  if (party.user_id) return { ...INITIAL_STATE, error: "This party is already linked to a login." };

  const email = (emailInput || party.contact_email || "").trim();
  if (!email) return { ...INITIAL_STATE, error: "Add a contact email for this party first." };
  if (!party.projects?.organization_id) return { ...INITIAL_STATE, error: "Could not resolve this party's organisation." };

  const serviceClient = createSupabaseServiceRoleClient();

  // Escape ILIKE's own wildcard characters so a literal email is matched (mirrors
  // addSelfManagedPartyAction's identical lookup) — case-insensitive since Supabase Auth normalises
  // emails to lowercase on signup.
  const escapedEmail = email.replace(/[%_\\]/g, (match) => `\\${match}`);
  const { data: existingUser } = await serviceClient
    .from("users")
    .select("id, is_active")
    .ilike("email", escapedEmail)
    .maybeSingle<{ id: string; is_active: boolean }>();

  let linkedUserId: string;
  let tempPassword: string | null = null;

  if (existingUser) {
    if (!existingUser.is_active) {
      return { ...INITIAL_STATE, error: "An account already exists for that email but has been deactivated." };
    }
    linkedUserId = existingUser.id;
  } else {
    tempPassword = generateTempPassword();
    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: party.contact_name || party.name },
    });

    if (createError || !created?.user) {
      return { ...INITIAL_STATE, error: `Could not create the account: ${createError?.message ?? "unknown error"}.` };
    }

    linkedUserId = created.user.id;

    // public.users.must_change_password is set by public.handle_new_auth_user()'s trigger (default
    // false); flip it true here so the next sign-in is forced through /reset-password. Must go
    // through the service-role client — guard_must_change_password
    // (20260929010000_party_login_provisioning.sql) blocks a plain RLS self-update of this column,
    // and this write isn't the linked user's own session anyway (they don't have one yet).
    const { error: flagError } = await serviceClient
      .from("users")
      .update({ must_change_password: true })
      .eq("id", linkedUserId);
    if (flagError) {
      // Real gap found in a transactional-integrity audit: this used to just error out, leaving
      // the just-created auth account behind with no tempPassword returned to the admin and no
      // party link — a genuinely orphaned, invisible login nobody could find or clean up.
      // Compensating rollback: delete the account we just created, so a retry starts clean
      // instead of leaving a stray credential behind.
      await serviceClient.auth.admin.deleteUser(linkedUserId).catch(() => {
        // Best-effort — if even the rollback fails, the error message below still tells the admin
        // an account may exist for this email so they know to check rather than assume nothing happened.
      });
      return {
        ...INITIAL_STATE,
        error: "Could not finish setting up the new account, so it was rolled back — try again. If this repeats, check whether an account for this email already exists before retrying.",
      };
    }
  }

  const { error: linkError } = await supabase
    .from("project_parties")
    .update({ user_id: linkedUserId })
    .eq("id", projectPartyId);
  if (linkError) {
    return {
      ...INITIAL_STATE,
      error: tempPassword
        ? "The account was created, but linking it to this party failed. Check with a JAGS Admin before sharing the password below."
        : "Could not link that account to this party. Check with a JAGS Admin.",
      tempPassword,
      email: tempPassword ? email : null,
    };
  }

  // Same best-effort, ignore-duplicate grant pattern as reassignSignoffPartyAction and
  // addSelfManagedPartyAction — has_org_access()/has_project_access() only ever look at
  // access_grants, never at project_parties.user_id, so this is what actually gives the new login
  // anything to see.
  const { error: grantError } = await supabase.from("access_grants").insert({
    user_id: linkedUserId,
    scope_type: "project",
    organization_id: party.projects.organization_id,
    project_id: party.project_id,
    role: party.party_type,
  });
  if (grantError && grantError.code !== "23505") {
    return {
      error: grantError.message.includes("seat limit")
        ? `${grantError.message} (the party is linked, but has no platform access yet.)`
        : "The party is linked, but granting platform access failed. Check with a JAGS Admin.",
      tempPassword,
      email: tempPassword ? email : null,
    };
  }

  try {
    await recordAuditEvent(supabase, {
      organizationId: party.projects.organization_id,
      projectId: party.project_id,
      entityType: "project_party",
      entityId: projectPartyId,
      action: tempPassword ? "login_provisioned" : "login_linked",
      actorId: session.userId,
      summary: tempPassword
        ? `New login created and granted access for party "${party.name}" (${email})`
        : `Existing account (${email}) linked and granted access for party "${party.name}"`,
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${party.project_id}`);
  return { error: null, tempPassword, email: tempPassword ? email : null };
}
