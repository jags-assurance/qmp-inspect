"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "scan"; factorId: string; qrCode: string; secret: string }
  | { kind: "verifying"; factorId: string; qrCode: string; secret: string };

/**
 * Enrolls a TOTP factor via supabase.auth.mfa.enroll(), then activates it with
 * challenge()+verify() once the user proves they can generate a valid code. Runs entirely
 * client-side against the browser Supabase client: the QR/secret only ever exist in the enroll
 * response, so there's nothing for a server action to relay, and challenge/verify need to run in
 * the same auth context that will hold the resulting AAL2 session.
 */
export function MfaEnrollForm({ staleFactorIds }: { staleFactorIds: string[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function startEnrollment() {
    setError(null);
    setStep({ kind: "starting" });
    const supabase = createSupabaseBrowserClient();

    // Clean up any abandoned enrollment attempts (started but never verified) before starting a
    // fresh one, so a user who scans, gets interrupted, and comes back isn't left accumulating
    // unverified factors.
    for (const id of staleFactorIds) {
      await supabase.auth.mfa.unenroll({ factorId: id });
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Could not start enrollment. Try again.");
      setStep({ kind: "idle" });
      return;
    }

    setStep({
      kind: "scan",
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "scan" && step.kind !== "verifying") return;
    setError(null);
    const { factorId, qrCode, secret } = step;
    setStep({ kind: "verifying", factorId, qrCode, secret });

    const supabase = createSupabaseBrowserClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError("Could not start the verification challenge. Try again.");
      setStep({ kind: "scan", factorId, qrCode, secret });
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });

    if (verifyError) {
      setError("That code didn't match. Check your authenticator app and try again.");
      setStep({ kind: "scan", factorId, qrCode, secret });
      setCode("");
      return;
    }

    router.refresh();
  }

  if (step.kind === "idle" || step.kind === "starting") {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-ink">Two-factor authentication is off</p>
        <p className="mt-1 text-xs text-muted">
          Enroll an authenticator app (Google Authenticator, 1Password, Authy, etc.) to require a
          6-digit code at sign-in, in addition to your password.
        </p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <Button
          type="button"
          className="mt-3"
          size="sm"
          disabled={step.kind === "starting"}
          onClick={startEnrollment}
        >
          {step.kind === "starting" ? "Starting…" : "Set up authenticator app"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-ink">Scan this QR code</p>
      <p className="mt-1 text-xs text-muted">
        Scan with your authenticator app, or enter the setup key manually, then enter the 6-digit
        code it generates below to finish.
      </p>

      <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        {/* qr_code from Supabase is a self-contained SVG data URI. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.qrCode} alt="Authenticator app QR code" className="h-40 w-40 rounded-md border border-border bg-white" />
        <div>
          <p className="text-xs font-medium text-ink">Setup key</p>
          <code className="mt-1 block break-all rounded-md bg-off-white px-2 py-1 text-xs text-ink">
            {step.secret}
          </code>
        </div>
      </div>

      <form onSubmit={verifyCode} className="mt-4 flex items-end gap-3">
        <div>
          <label htmlFor="mfa-code" className="block text-sm font-medium text-ink">
            6-digit code
          </label>
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-32 rounded-md border border-border bg-surface px-3 py-2 text-sm tracking-widest outline-none focus:border-burgundy"
          />
        </div>
        <Button type="submit" size="sm" disabled={step.kind === "verifying" || code.length !== 6}>
          {step.kind === "verifying" ? "Verifying…" : "Verify & activate"}
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
