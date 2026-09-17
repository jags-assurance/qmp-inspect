"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";

export interface MfaActionState {
  error: string | null;
}

const SECURITY_PATH = "/inspect/organisation/security";

/**
 * Removes a TOTP factor from the signed-in user's own account. Enrollment/verification itself
 * happens client-side (see mfa-enroll-form.tsx) because supabase-js's mfa.enroll() only returns
 * the QR/secret once, in the response of the call that creates the factor — there's no server-side
 * equivalent that can hand a freshly-generated secret back to the browser. Unenrollment has no such
 * constraint, so it's a plain server action like every other mutation in this app.
 */
export async function unenrollFactorAction(
  _prev: MfaActionState,
  formData: FormData
): Promise<MfaActionState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "MFA is only available for JAGS staff accounts." };
  }

  const factorId = String(formData.get("factor_id") ?? "").trim();
  if (!factorId) {
    return { error: "Missing factor." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    return { error: "Could not remove that authenticator. Try again." };
  }

  revalidatePath(SECURITY_PATH);
  return { error: null };
}
