import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/auth/actions";
import { MfaChallengeForm } from "./mfa-challenge-form";

/**
 * Stands between password sign-in and a full (AAL2) session for any account with a verified TOTP
 * factor. Reached two ways: signInAction redirects here directly right after a successful
 * password check (lib/auth/actions.ts), and proxy.ts redirects here from anywhere else if a
 * signed-in user's session hasn't reached AAL2 yet but their account requires it — e.g. an
 * existing browser session from before MFA was enrolled, or a direct URL visit.
 */
export default async function MfaChallengePage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Nothing to challenge: either no verified factor exists (nextLevel stays aal1) or this session
  // already cleared it. Either way, this page has no reason to be shown.
  if (!aal || aal.nextLevel !== "aal2" || aal.currentLevel === "aal2") {
    redirect("/");
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const factorId = factorsData?.totp?.find((f) => f.status === "verified")?.id;
  if (!factorId) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold text-ink">Two-factor verification</h1>
        <p className="mt-1 text-sm text-muted">
          Enter the 6-digit code from your authenticator app to finish signing in.
        </p>
        <MfaChallengeForm factorId={factorId} />
        <form action={signOutAction} className="mt-4">
          <button type="submit" className="text-xs text-muted hover:underline">
            Not you? Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
