"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { checkThrottle, clearAttempts, recordAttempt } from "./throttle";
import { mfaEnabled, normaliseTotpCode } from "./mfa";
import { safeNextPath } from "./safe-redirect";

export interface MfaState {
  error: string | null;
  success?: string | null;
}

export interface MfaEnrolState {
  error: string | null;
  factorId?: string;
  qr?: string;
  secret?: string;
}

const OFF = "Two-step sign-in is not switched on for this deployment.";
const BAD_CODE = "That code did not work. Check the time on your phone and try the newest code.";

async function currentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Starts enrolling an authenticator app: returns the QR code and the manual secret. Any earlier unfinished enrolment is dropped first. */
export async function startMfaEnrolAction(): Promise<MfaEnrolState> {
  if (!mfaEnabled()) return { error: OFF };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Sign in first." };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator app ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: "Could not start the setup. Try again." };
  return { error: null, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirms the enrolment with the first code from the app. */
export async function confirmMfaEnrolAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  if (!mfaEnabled()) return { error: OFF };
  const factorId = String(formData.get("factor_id") ?? "").trim();
  const code = normaliseTotpCode(String(formData.get("code") ?? ""));
  if (!factorId) return { error: "Start the setup again." };
  if (!code) return { error: "Enter the 6-digit code from your authenticator app." };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Sign in first." };

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: BAD_CODE };
  await recordAuditEvent(supabase, { entityType: "auth", entityId: user.id, action: "mfa_enrolled", actorId: user.id, summary: "Two-step sign-in switched on" });
  return { error: null, success: "Two-step sign-in is on. You will be asked for a code each time you sign in." };
}

/** Switches two-step sign-in off. Supabase only allows this from a session that already passed the code step. */
export async function removeMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  if (!mfaEnabled()) return { error: OFF };
  const factorId = String(formData.get("factor_id") ?? "").trim();
  if (!factorId) return { error: "Missing factor." };
  const { supabase, user } = await currentUser();
  if (!user) return { error: "Sign in first." };
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: "Could not switch it off. Sign out, sign in again with your code, and retry." };
  await recordAuditEvent(supabase, { entityType: "auth", entityId: user.id, action: "mfa_removed", actorId: user.id, summary: "Two-step sign-in switched off" });
  return { error: null, success: "Two-step sign-in is off." };
}

/** The sign-in step after the password: checks the code and upgrades the session to AAL2. Throttled per user. */
export async function verifyMfaLoginAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  if (!mfaEnabled()) return { error: OFF };
  const code = normaliseTotpCode(String(formData.get("code") ?? ""));
  if (!code) return { error: "Enter the 6-digit code from your authenticator app." };
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const key = `mfa:${user.id}`;
  if ((await checkThrottle("signin", key)).blocked) return { error: "Too many attempts. Wait a few minutes and try again." };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect(safeNextPath(String(formData.get("next") ?? "/")));

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await recordAttempt("signin", key);
    return { error: BAD_CODE };
  }
  await clearAttempts("signin", key);
  redirect(safeNextPath(String(formData.get("next") ?? "/")));
}
