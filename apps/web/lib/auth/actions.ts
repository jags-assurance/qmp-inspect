"use server";

import type { FieldErrors } from "@/lib/forms/field-errors";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/log";
import { getAppUrl } from "./app-url";
import { checkPasswordPolicy } from "./password-policy";
import { mfaChallengePath, mfaEnabled, needsMfaChallenge } from "./mfa";
import { safeNextPath } from "./safe-redirect";
import { IDLE_LOGIN_PATH } from "./login-notices";
import { checkThrottle, clearAttempts, recordAttempt } from "./throttle";

export interface SignInState {
  error: string | null;
  /** Per-input problems (keys are form field names), shown next to the field; `error` stays the fallback. */
  fieldErrors?: FieldErrors;
}

const TOO_MANY_ATTEMPTS = "Too many attempts. Wait a few minutes and try again, or use Forgot password.";

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return {
      error: "Enter your email and password.",
      fieldErrors: {
        ...(email ? {} : { email: "Enter your email." }),
        ...(password ? {} : { password: "Enter your password." }),
      },
    };
  }

  // App-level throttle (in addition to Supabase's own limits): refuse before even checking the
  // password so a guessing run gets no signal once the limit is reached.
  if ((await checkThrottle("signin", email)).blocked) {
    return { error: TOO_MANY_ATTEMPTS };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  // An auth-service outage or network failure is not a wrong password: say so, and don't count it
  // toward the 5-per-email lockout (on dev under load, correct passwords were rejected this way).
  if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) {
    return { error: "Sign-in is temporarily unavailable. Please try again in a moment." };
  }
  if (error || !data?.user) {
    await recordAttempt("signin", email);
    // Same message for a wrong password, an unknown email, an unconfirmed or a deactivated account.
    return { error: "Invalid email or password." };
  }

  await clearAttempts("signin", email);
  const userId = data.user.id;
  // Audit the sign-in without delaying the redirect; failures are logged by recordAuditEvent.
  after(() =>
    recordAuditEvent(supabase, {
      entityType: "auth",
      entityId: userId,
      action: "sign_in",
      actorId: userId,
      summary: "Signed in",
    })
  );

  const next = safeNextPath(String(formData.get("next") ?? "/"));
  // Two-step sign-in: a user with an authenticator app goes to the code step first (the proxy enforces it too).
  if (mfaEnabled()) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (needsMfaChallenge(aal)) redirect(mfaChallengePath(next));
  }
  redirect(next);
}

export interface RequestPasswordResetState {
  error: string | null;
  sent: boolean;
}

/**
 * Always reports success (never reveals whether the email is a real account) — the standard
 * anti-enumeration practice for a "forgot password" flow. Supabase's own resetPasswordForEmail
 * call is likewise silent about whether the address exists. Requests are throttled per email and IP.
 */
export async function requestPasswordResetAction(
  _prev: RequestPasswordResetState,
  formData: FormData
): Promise<RequestPasswordResetState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address.", sent: false };

  // Over the limit: pretend it worked (no signal to an attacker, no mail flood to the victim).
  if ((await checkThrottle("reset", email)).blocked) {
    return { error: null, sent: true };
  }
  await recordAttempt("reset", email);

  const supabase = await createSupabaseServerClient();
  // Built from the configured public URL, never from the request's (spoofable) Origin header.
  const appUrl = await getAppUrl();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/confirm?next=/reset-password`,
  });

  return { error: null, sent: true };
}

export interface UpdatePasswordState {
  error: string | null;
}

/**
 * Called both from the recovery-link flow (session already active, exchanged by
 * app/auth/confirm/route.ts before the user ever reaches /reset-password) and from the forced
 * first-login flow (a party login provisioned with a temporary password — see
 * lib/projects/party-provisioning.ts — signs in normally, then proxy.ts redirects them here before
 * they can reach anywhere else). Either way, updateUser operates on the caller's own already-
 * authenticated session, not a fresh sign-in.
 */
export async function updatePasswordAction(
  _prev: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Request a new one and try again." };

  const policy = checkPasswordPolicy(password, { email: user.email });
  if (!policy.ok) return { error: policy.error };
  if (password !== confirmPassword) return { error: "Passwords don't match." };

  const { error } = await supabase.auth.updateUser({ password });
  // A retry after a previous partial success (password changed, flag clear failed) re-submits the
  // same password, which Supabase refuses as "same password"; that is fine — carry on to clear the flag.
  if (error && (error as { code?: string }).code !== "same_password") {
    return { error: "Could not update your password. Request a new reset link and try again." };
  }

  // Clears the forced-first-login flag once a real new password has actually been accepted above.
  // Deliberately done via the service-role client, not the user's own RLS-scoped session — see
  // guard_must_change_password (supabase/migrations/20260929010000_party_login_provisioning.sql)
  // and users_guard_privileged_columns (20261104000100) for why a self-update of this column is
  // blocked outright. Both the table column and the auth app_metadata claim (which proxy.ts reads
  // without a DB query) are cleared. A failure is surfaced rather than swallowed: otherwise the user
  // is bounced back to /reset-password with no explanation.
  if (isServiceRoleConfigured()) {
    const serviceClient = createSupabaseServiceRoleClient();
    const [profileResult, metaResult] = await Promise.all([
      serviceClient.from("users").update({ must_change_password: false }).eq("id", user.id),
      serviceClient.auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: false, temp_password_expires_at: null } }),
    ]);
    if (profileResult.error || metaResult.error) {
      console.error(
        `[auth] could not clear must_change_password for ${user.id}: ${profileResult.error?.message ?? metaResult.error?.message}`
      );
      return {
        error:
          "Your password was updated, but we couldn't finish activating your account. Submit the form once more; if it keeps failing, contact your administrator.",
      };
    }
  }

  // Revoke every other session for this user (a leaked temporary password stops working elsewhere).
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);

  await recordAuditEvent(supabase, {
    entityType: "auth",
    entityId: user.id,
    action: "password_changed",
    actorId: user.id,
    summary: "Password changed",
  });

  redirect("/login");
}

export async function signOutAction() {
  await signOutAndRedirect("/login");
}

/** Client idle-timer sign-out: same as signOutAction but lands on the login page with the "signed out
 *  after inactivity" notice, matching what proxy.ts shows for a server-side idle expiry. */
export async function idleSignOutAction() {
  await signOutAndRedirect(IDLE_LOGIN_PATH);
}

async function signOutAndRedirect(destination: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await recordAuditEvent(supabase, {
      entityType: "auth",
      entityId: user.id,
      action: "sign_out",
      actorId: user.id,
      summary: "Signed out",
    });
  }
  await supabase.auth.signOut();
  redirect(destination);
}
