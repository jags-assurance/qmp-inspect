"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Runs challengeAndVerify() against the browser Supabase client so the resulting AAL2 session
 * lands in this tab's own cookies immediately (same reasoning as the enroll form: this needs to
 * run in the auth context that ends up holding the session, not relayed through a server action).
 * proxy.ts re-checks the assurance level on the next navigation and stops redirecting here once
 * it sees aal2.
 */
export function MfaChallengeForm({ factorId }: { factorId: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    });

    if (verifyError) {
      setError("Incorrect code. Try again.");
      setCode("");
      setPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="mfa-challenge-code" className="block text-sm font-medium text-ink">
          6-digit code
        </label>
        <input
          id="mfa-challenge-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm tracking-widest outline-none focus:border-burgundy"
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={pending || code.length !== 6} className="w-full">
        {pending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
