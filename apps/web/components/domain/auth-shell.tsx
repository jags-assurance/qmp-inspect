import type { ReactNode } from "react";
import { Tx } from "@/components/domain/tx";

/**
 * Frame for the signed-out auth pages (sign in, forgot / reset password): a brand panel from md
 * (hidden on phones) and a centred card with the form. Server-safe. Inputs inside use text-base
 * on phones (globals.css) so iOS does not zoom.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-1/2 flex-col justify-center bg-burgundy px-10 text-white md:flex lg:px-16">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold text-lg font-semibold">
          <Tx>JA</Tx>
        </div>
        <p className="mt-8 text-3xl font-semibold"><Tx>JAGS Assurance</Tx></p>
        <p className="mt-3 max-w-sm text-white/80">
          <Tx>Controlled quality. Assured outcomes. Sign in to the Quality Management Platform.</Tx>
        </p>
      </div>
      <main className="flex w-full flex-col items-center justify-center bg-background px-4 py-8 sm:px-8 md:w-1/2">
        <div className="mb-6 flex items-center gap-3 md:hidden">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-gold bg-burgundy text-sm font-semibold text-white" aria-hidden="true">
            <Tx>JA</Tx>
          </div>
          <span className="text-lg font-semibold text-ink"><Tx>JAGS Assurance</Tx></span>
        </div>
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-8">{children}</div>
      </main>
    </div>
  );
}
