import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MfaEnrollForm } from "./mfa-enroll-form";
import { UnenrollFactorButton } from "./unenroll-factor-button";

/**
 * Account-level security (TOTP MFA enrollment) for a JAGS staff member's own login. Unlike the
 * rest of /inspect/organisation/*, this isn't an Admin-only administrative screen — it's each
 * staff member's own account, so any JAGS staff login (Admin or Inspector) can reach it and
 * manage their own factor. It lives under organisation/ anyway to match the existing account-
 * settings navigation grouping rather than inventing a new top-level section for one page.
 *
 * MFA is opt-in for now: enrolling here does not yet make MFA mandatory for anyone (see
 * proxy.ts / lib/auth/actions.ts — the AAL2 challenge only triggers for an account that already
 * has a verified factor). Making it mandatory for all JAGS staff is a follow-up policy decision.
 */
export default async function SecuritySettingsPage() {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const totpFactors = factorsData?.totp ?? [];
  const verifiedFactors = totpFactors.filter((f) => f.status === "verified");
  const unverifiedFactors = totpFactors.filter((f) => f.status !== "verified");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-ink">Account security</h1>
      <p className="mt-1 text-sm text-muted">
        Add an authenticator app as a second sign-in step for your own account. This is
        particularly important for JAGS Admin accounts, which can see every client&apos;s data.
      </p>

      {verifiedFactors.length > 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium text-ink">Two-factor authentication is on</p>
          <p className="mt-1 text-xs text-muted">
            You&apos;ll be asked for a 6-digit code from your authenticator app each time you sign in.
          </p>
          <div className="mt-3 space-y-2">
            {verifiedFactors.map((factor) => (
              <div key={factor.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">
                  {factor.friendly_name || "Authenticator app"}{" "}
                  <span className="text-muted">
                    · added {new Date(factor.created_at).toLocaleDateString()}
                  </span>
                </span>
                <UnenrollFactorButton factorId={factor.id} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <MfaEnrollForm staleFactorIds={unverifiedFactors.map((f) => f.id)} />
        </div>
      )}
    </div>
  );
}
