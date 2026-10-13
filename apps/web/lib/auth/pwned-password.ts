import { createHash } from "node:crypto";

// Leaked-password check (Have I Been Pwned range API, k-anonymity: only the first 5 hex chars of the
// SHA-1 leave the server). FAILS OPEN: any network error, timeout or non-200 answer returns false so a
// third-party outage never blocks a sign-in or password change.

export const PWNED_PASSWORD_MESSAGE = "This password has appeared in a known data breach. Choose a different one.";
const TIMEOUT_MS = 3000;

export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [hash, count] = line.trim().split(":");
      if (hash && hash.toUpperCase() === suffix) return Number(count) >= 1;
    }
    return false;
  } catch {
    return false;
  }
}
