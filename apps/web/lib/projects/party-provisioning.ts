"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { discardSeatOverride, grantSeatOverride, isSeatLimitError, parseSeatOverride, seatLimitMessage } from "@/lib/plans/seat-limit";
import { hasPermission } from "@/lib/rbac/permissions";
import { generateTempPassword, tempPasswordExpiry } from "./temp-password";
import { sendEmail } from "@/lib/notifications/email";
import { loadEmailOrgBrand } from "@/lib/notifications/org-brand-email";
import { isUndeliverableAddress } from "@/lib/notifications/undeliverable";
import { LOGIN_INVITE_SUBJECT, renderLoginInviteEmailHtml } from "./login-invite-email";

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
  /** When the temporary password stops working (ISO). Shown next to it so the admin knows how long
   *  they have to hand it over. */
  expiresAt?: string | null;
  /** Status of the sign-in-link email for a NEW account: "sent", "failed", or "not_configured" (no RESEND_API_KEY). Null when no account was created. */
  emailStatus?: "sent" | "failed" | "not_configured" | null;
}

// Not exported: a "use server" file may only export async functions — see
// provision-party-login-form.tsx, which defines its own copy of this shape as every other
// useActionState initial-state constant in this app already does (e.g. reassign-party-form.tsx).
const INITIAL_STATE: ProvisionPartyLoginState = { error: null, tempPassword: null, email: null, expiresAt: null, emailStatus: null };

/** Provisioning is rate limited per actor: this many credential-issuing events per hour. */
const PROVISION_LIMIT_PER_HOUR = 20;

const NEUTRAL_UNAVAILABLE =
  "That email can't be provisioned from here. Check the address, or ask a JAGS Admin to set this person up.";

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
 *      A JAGS Admin may link any account; anyone else (a client_managed provisioner) only an account
 *      that already belongs to the same organisation — never another tenant's user or JAGS staff.
 *   2. No account exists → create one via the Supabase Auth admin API with a random temporary
 *      password that expires (TEMP_PASSWORD_TTL_HOURS, default 72h), flag it must_change_password
 *      (both on public.users and in the auth user's app_metadata, which proxy.ts reads without a DB
 *      query) so the next sign-in is forced through /reset-password before anywhere else, then link +
 *      grant exactly as path 1.
 *
 * The create + link + grant sequence is all-or-nothing: if linking or granting fails, the link is
 * undone and a newly created account is deleted again, so no orphaned credential survives. The
 * access grant itself is written with the service role AFTER the permission check above (the RLS
 * insert policy is deliberately narrow — see 20261104000200 — and this action is the one audited,
 * permission-checked place that may mint a party login).
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

  const admin = isAdminStaff(session);
  // JAGS Admin, always; OR — the "Full Client-Managed" tier's whole point — someone holding the
  // provision_party_login custom permission on this party's own project, which the RLS side
  // (project_parties_client_managed_provision, if/when the DB grant is added) would enforce anyway.
  // This app-layer check exists for a clear error message; hasPermission() is never the real gate.
  if (!admin && !(await hasPermission(session.userId, "provision_party_login", party.project_id))) {
    return { ...INITIAL_STATE, error: "Only a JAGS Admin (or someone granted this permission) can grant a party platform access." };
  }

  if (party.user_id) return { ...INITIAL_STATE, error: "This party is already linked to a login." };

  const email = (emailInput || party.contact_email || "").trim();
  if (!email) return { ...INITIAL_STATE, error: "Add a contact email for this party first." };
  const organizationId = party.projects?.organization_id;
  if (!organizationId) return { ...INITIAL_STATE, error: "Could not resolve this party's organisation." };

  const serviceClient = createSupabaseServiceRoleClient();

  // Per-actor rate limit (counts credential issuances recorded in the audit log, which RLS lets this
  // actor read for their own organisation). Fails open if the log can't be read.
  try {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await serviceClient
      .from("audit_log" as never)
      .select("id", { count: "exact", head: true })
      .eq("actor_id", session.userId)
      .in("action", ["login_provisioned", "login_linked", "login_provision_failed"])
      .gte("created_at", since);
    if ((count ?? 0) >= PROVISION_LIMIT_PER_HOUR) {
      return { ...INITIAL_STATE, error: "Too many logins provisioned in the last hour. Try again later." };
    }
  } catch {
    // Fail open — the permission check above is the real gate.
  }

  // Escape ILIKE's own wildcard characters so a literal email is matched (mirrors
  // addSelfManagedPartyAction's identical lookup) — case-insensitive since Supabase Auth normalises
  // emails to lowercase on signup.
  const escapedEmail = email.replace(/[%_\\]/g, (match) => `\\${match}`);
  const { data: existingUser } = await serviceClient
    .from("users")
    .select("id, is_active, is_jags_staff")
    .ilike("email", escapedEmail)
    .maybeSingle<{ id: string; is_active: boolean; is_jags_staff: boolean }>();

  let linkedUserId: string;
  let tempPassword: string | null = null;
  let expiresAt: string | null = null;
  let createdAccount = false;

  if (existingUser) {
    // Linking someone else's account hands this project to a person who never agreed to it, and
    // differing messages would confirm which emails have accounts. A JAGS Admin may link any active
    // account; everyone else only an account already inside this organisation, and every refusal
    // reads the same.
    if (!existingUser.is_active) return { ...INITIAL_STATE, error: NEUTRAL_UNAVAILABLE };
    if (!admin) {
      const { data: sameOrg } = await serviceClient.rpc("user_has_org_access", {
        target_user_id: existingUser.id,
        target_org_id: organizationId,
      });
      if (sameOrg !== true || existingUser.is_jags_staff) return { ...INITIAL_STATE, error: NEUTRAL_UNAVAILABLE };
    }
    linkedUserId = existingUser.id;
  } else {
    tempPassword = generateTempPassword();
    expiresAt = tempPasswordExpiry();
    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: party.contact_name || party.name },
      // Read by proxy.ts straight from the verified auth user — no database query per request.
      app_metadata: { must_change_password: true, temp_password_expires_at: expiresAt },
    });

    if (createError || !created?.user) {
      console.error(`[provisioning] createUser failed: ${createError?.message ?? "unknown error"}`);
      return { ...INITIAL_STATE, error: "Could not create the account. Check the email address and try again." };
    }

    linkedUserId = created.user.id;
    createdAccount = true;

    // public.users.must_change_password is set by public.handle_new_auth_user()'s trigger (default
    // false); flip it true here as well so the database-level enforcement (has_org_access() and
    // friends refuse a user who still has to change their password) applies too. Must go through the
    // service-role client — guard_must_change_password blocks a plain RLS self-update of this column.
    const { error: flagError } = await serviceClient
      .from("users")
      .update({ must_change_password: true })
      .eq("id", linkedUserId);
    if (flagError) {
      // Compensating rollback: delete the account we just created, so a retry starts clean
      // instead of leaving a stray credential behind.
      await serviceClient.auth.admin.deleteUser(linkedUserId).catch(() => undefined);
      return {
        ...INITIAL_STATE,
        error: "Could not finish setting up the new account, so it was rolled back — try again. If this repeats, check whether an account for this email already exists before retrying.",
      };
    }
  }

  // Undoes everything this call did, in reverse. Used for any failure after the account exists.
  const rollback = async () => {
    await serviceClient.from("project_parties").update({ user_id: null }).eq("id", projectPartyId);
    if (createdAccount) await serviceClient.auth.admin.deleteUser(linkedUserId).catch(() => undefined);
  };

  const { error: linkError } = await supabase
    .from("project_parties")
    .update({ user_id: linkedUserId })
    .eq("id", projectPartyId);
  if (linkError) {
    if (createdAccount) await serviceClient.auth.admin.deleteUser(linkedUserId).catch(() => undefined);
    await auditProvisioning(supabase, party, organizationId, session.userId, "login_provision_failed", email, "link failed");
    return { ...INITIAL_STATE, error: "Could not link that account to this party, so nothing was created. Check with a JAGS Admin." };
  }

  // Best effort: when the party has no contact name, copy the linked person's own name into it so every
  // viewer (client, contractor, TPI) sees who is behind the party without needing to read the users table.
  if (!party.contact_name?.trim()) {
    const { data: linkedUser } = await serviceClient.from("users").select("full_name").eq("id", linkedUserId).maybeSingle<{ full_name: string | null }>();
    const personName = linkedUser?.full_name?.trim();
    if (personName && personName !== party.name) {
      await serviceClient.from("project_parties").update({ contact_name: personName }).eq("id", projectPartyId);
    }
  }

  // Written with the service role after the permission check above — see this function's header.
  // Duplicate-tolerant (the user may already hold this project grant), and the seat-limit trigger
  // still applies.
  const insertGrant = () =>
    serviceClient.from("access_grants").insert({
      user_id: linkedUserId,
      scope_type: "project",
      organization_id: organizationId,
      project_id: party.project_id,
      role: party.party_type,
    });
  let { error: grantError } = await insertGrant();

  // Seat limit reached: only a JAGS Admin who ticked the override and gave a reason may exceed it.
  let overrideReason: string | null = null;
  if (grantError && isSeatLimitError(grantError.message) && admin) {
    const override = parseSeatOverride(formData);
    if (override.requested && !override.error) {
      const overrideId = await grantSeatOverride(serviceClient, {
        organizationId,
        userId: linkedUserId,
        reason: override.reason,
        actorId: session.userId,
      });
      if (overrideId) {
        ({ error: grantError } = await insertGrant());
        if (grantError && grantError.code !== "23505") await discardSeatOverride(serviceClient, overrideId);
        else overrideReason = override.reason;
      }
    }
  }
  if (grantError && grantError.code !== "23505") {
    await rollback();
    await auditProvisioning(supabase, party, organizationId, session.userId, "login_provision_failed", email, "grant failed");
    return {
      ...INITIAL_STATE,
      error: isSeatLimitError(grantError.message)
        ? `${seatLimitMessage(grantError.message, admin)} Nothing was created.`
        : "Granting platform access failed, so the account was not created. Try again, or check with a JAGS Admin.",
    };
  }

  if (overrideReason) {
    await recordAuditEvent(supabase, {
      organizationId,
      projectId: party.project_id,
      entityType: "organization_plan",
      entityId: organizationId,
      action: "seat_limit_overridden",
      actorId: session.userId,
      summary: `Seat limit overridden to give party "${party.name}" (${email}) access: ${overrideReason}`,
      changes: { user_id: linkedUserId, reason: overrideReason, via: "party_login" },
    });
  }

  await auditProvisioning(
    supabase,
    party,
    organizationId,
    session.userId,
    createdAccount ? "login_provisioned" : "login_linked",
    email,
    createdAccount ? `temporary password expires ${expiresAt}` : "existing account linked"
  );

  revalidatePath(`/inspect/projects/${party.project_id}`);
  // Best-effort sign-in-link email for a NEW account. The temporary password is NOT in it.
  let emailStatus: ProvisionPartyLoginState["emailStatus"] = null;
  if (createdAccount) {
    if (!process.env.RESEND_API_KEY || isUndeliverableAddress(email)) {
      emailStatus = "not_configured";
    } else {
      try {
        await sendEmail({
          toEmail: email,
          subject: LOGIN_INVITE_SUBJECT,
          html: renderLoginInviteEmailHtml({
            appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
            loginEmail: email,
            expiresAt,
            brand: await loadEmailOrgBrand(organizationId),
          }),
        });
        emailStatus = "sent";
      } catch (err) {
        console.error(`[provisioning] login email failed: ${err instanceof Error ? err.message : "unknown"}`);
        emailStatus = "failed";
      }
    }
  }
  return { error: null, tempPassword, email: tempPassword ? email : null, expiresAt, emailStatus };
}

async function auditProvisioning(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  party: { id: string; project_id: string; name: string },
  organizationId: string,
  actorId: string,
  action: "login_provisioned" | "login_linked" | "login_provision_failed",
  email: string,
  detail: string
) {
  const summary =
    action === "login_provisioned"
      ? `New login created and granted access for party "${party.name}" (${email})`
      : action === "login_linked"
        ? `Existing account (${email}) linked and granted access for party "${party.name}"`
        : `Login provisioning for party "${party.name}" (${email}) failed and was rolled back`;
  await recordAuditEvent(supabase, {
    organizationId,
    projectId: party.project_id,
    entityType: "project_party",
    entityId: party.id,
    action,
    actorId,
    summary,
    changes: { detail },
  });
}


export interface ExistingPersonMatch {
  name: string;
  email: string;
}

/**
 * Type-ahead for "add a person who already works on another project": matches active, non-staff
 * accounts by name or email so a JAGS Admin can pick one instead of retyping the address. Admin only
 * (it reads other people's accounts through the service role), minimum two characters, at most eight
 * hits, and returns nothing but name + email.
 */
export async function searchExistingPeopleAction(query: string): Promise<ExistingPersonMatch[]> {
  const session = await requireSession();
  if (!isAdminStaff(session) || !isServiceRoleConfigured()) return [];
  const q = String(query ?? "").trim().replace(/[%_\\,()*]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return [];
  const serviceClient = createSupabaseServiceRoleClient();
  const { data } = await serviceClient
    .from("users")
    .select("full_name, email")
    .eq("is_active", true)
    .eq("is_jags_staff", false)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order("full_name", { ascending: true })
    .limit(8)
    .returns<{ full_name: string | null; email: string | null }[]>();
  return (data ?? []).filter((u) => u.email).map((u) => ({ name: u.full_name?.trim() || u.email!, email: u.email! }));
}
