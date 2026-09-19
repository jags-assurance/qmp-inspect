"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  redirect("/");
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
 * Called from /reset-password once the recovery link's session is active (exchanged by
 * app/auth/confirm/route.ts before the user ever reaches that page) — updateUser here operates on
 * that already-authenticated session, not a fresh sign-in.
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
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Could not update your password. Request a new reset link and try again." };

  redirect("/login");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
