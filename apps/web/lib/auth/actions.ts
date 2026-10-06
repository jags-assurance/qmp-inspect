"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";

export interface SignInState {
  error: string | null;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
}

export interface RequestPasswordResetState {
  error: string | null;
  sent: boolean;
}

/**
 * Always reports success (never reveals whether the email is a real account) — the standard
 * anti-enumeration practice for a "forgot password" flow. Supabase's own resetPasswordForEmail
 * call is likewise silent about whether the address exists.
 */
export async function requestPasswordResetAction(
  _prev: RequestPasswordResetState,
  formData: FormData
): Promise<RequestPasswordResetState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address.", sent: false };

  const supabase = await createSupabaseServerClient();
  const origin = (await headers()).get("origin") ?? "";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
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

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirmPassword) return { error: "Passwords don't match." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not update your password. Request a new reset link and try again." };

  // Clears the forced-first-login flag once a real new password has actually been accepted above.
  // Deliberately done via the service-role client, not the user's own RLS-scoped session — see
  // guard_must_change_password (supabase/migrations/20260929010000_party_login_provisioning.sql)
  // for why an ordinary self-update of this column is blocked outright. Best-effort: a user who
  // reached this via the plain "forgot password" flow rather than a forced first login simply has
  // nothing to clear either way, and a failure here should never block a password change that has
  // already genuinely succeeded.
  if (user?.id && isServiceRoleConfigured()) {
    try {
      const serviceClient = createSupabaseServiceRoleClient();
      await serviceClient.from("users").update({ must_change_password: false }).eq("id", user.id);
    } catch {
      // Best-effort — see comment above.
    }
  }

  redirect("/login");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
