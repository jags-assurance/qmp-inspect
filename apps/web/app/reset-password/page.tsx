import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";
import { AuthShell } from "@/components/domain/auth-shell";

export const metadata: Metadata = { title: "Reset password" };

/**
 * Server component wrapper only, so `forced` can be read from `searchParams` (server-only prop —
 * useSearchParams() in a client component would need its own Suspense boundary; this app has no
 * existing precedent for that, so this follows the plain-server-component pattern already used
 * elsewhere, e.g. app/inspect/ncrs/new/page.tsx). Set by proxy.ts when a signed-in user with
 * must_change_password still set gets redirected here from any other route — same page and action
 * as the "forgot password" recovery flow (lib/auth/actions.ts's updatePasswordAction), just
 * different copy for why they're here.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ forced?: string }>;
}) {
  const { forced } = await searchParams;

  return (
    <AuthShell>
      <ResetPasswordForm isForced={forced === "1"} />
    </AuthShell>
  );
}
