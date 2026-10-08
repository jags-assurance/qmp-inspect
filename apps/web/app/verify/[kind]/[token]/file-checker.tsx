"use client";

import { useState } from "react";
import { MATCH_LABEL, matchFileHash, MAX_CHECK_BYTES, type KnownHashes } from "@/lib/verify/hash-match";

type Outcome = { state: "idle" } | { state: "working" } | { state: "error"; message: string } | { state: "done"; matched: boolean; label?: string; hash: string };

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hashes the chosen file in the browser (it is never uploaded) and compares it with the recorded fingerprints. */
export function FileChecker({ known }: { known: KnownHashes }) {
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_CHECK_BYTES) {
      setOutcome({ state: "error", message: "That file is too large to check here." });
      return;
    }
    if (!globalThis.crypto?.subtle) {
      setOutcome({ state: "error", message: "This browser cannot compute a file fingerprint. Use a current browser over HTTPS." });
      return;
    }
    setOutcome({ state: "working" });
    try {
      const hash = await sha256Hex(file);
      const result = matchFileHash(hash, known);
      setOutcome({ state: "done", matched: result.matched, label: result.matched ? MATCH_LABEL[result.kind] : undefined, hash });
    } catch {
      setOutcome({ state: "error", message: "The file could not be read." });
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Check a file you hold</h2>
      <p className="mt-1 text-xs text-muted">Choose your copy of the PDF. Its fingerprint is worked out on your device; the file is not uploaded.</p>
      <input type="file" onChange={onChange} aria-label="File to check" className="mt-3 block w-full text-sm text-ink" />
      <div aria-live="polite" className="mt-3 text-sm">
        {outcome.state === "working" && <p className="text-muted">Checking…</p>}
        {outcome.state === "error" && <p className="text-danger">{outcome.message}</p>}
        {outcome.state === "done" && outcome.matched && (
          <p className="font-semibold text-success">Match: this file is byte-for-byte {outcome.label}.</p>
        )}
        {outcome.state === "done" && !outcome.matched && (
          <p className="font-semibold text-danger">No match: this file is not one the system recorded for this document. It may have been changed, or be a different version.</p>
        )}
        {outcome.state === "done" && <p className="mt-1 break-all font-mono text-xs text-muted">SHA-256 {outcome.hash}</p>}
      </div>
    </section>
  );
}
