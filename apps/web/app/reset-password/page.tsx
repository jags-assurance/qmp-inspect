import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";
import { T } from "@/components/domain/t";

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
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-center bg-burgundy px-16 text-white md:flex">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold text-lg font-semibold">
          <T>JA</T>
        </div>
        <h1 className="mt-8 text-3xl font-semibold"><T>JAGS Assurance</T></h1>
        <p className="mt-3 max-w-sm text-white/80">
          <T>Controlled quality. Assured outcomes. Sign in to the Quality Management Platform.</T>
        </p>
      </div>
      <div className="flex w-full flex-col justify-center px-8 md:w-1/2 md:px-20">
        <ResetPasswordForm isForced={forced === "1"} />
      </div>
    </div>
  );
}
