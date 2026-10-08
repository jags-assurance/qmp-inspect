import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mfaEnabled } from "@/lib/auth/mfa";
import { SecuritySettings } from "./security-settings";
import { T } from "@/components/domain/t";

export const metadata = { title: "Account security" };

export default async function AccountSecurityPage() {
  if (!mfaEnabled()) notFound();
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.[0] ?? null;
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-ink"><T>Account security</T></h1>
      <p className="mt-1 text-sm text-muted"><T>Two-step sign-in asks for a code from an authenticator app after your password.</T></p>
      <SecuritySettings verifiedFactorId={verified?.id ?? null} />
    </div>
  );
}
