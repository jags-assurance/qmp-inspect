// Password policy shared by the reset / forced-change flow. Pure, so it unit-tests without a server.
//
// Supabase Auth only enforces its own minimum length; JAGS issues temporary passwords to external
// parties, so a stronger floor is applied here: at least 8 characters, not on a short list of the
// most common passwords, not made of one repeated character / a trivial sequence, and not derived
// from the account's own email. Turning on Supabase's "Prevent use of leaked passwords" (Auth >
// Policies, Pro plan) adds a HaveIBeenPwned check on top — see docs/SECURITY_HARDENING.md.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Lower-cased. Includes the usual offenders plus product-flavoured guesses; matched after stripping
// digits/symbols from the ends too (so "Password123!" is caught).
const COMMON_PASSWORDS = new Set([
  "password", "passw0rd", "p@ssw0rd", "p@ssword", "password1", "password12", "password123", "password1234",
  "123456", "1234567", "12345678", "123456789", "1234567890", "0123456789", "12345678910", "11111111", "00000000",
  "qwerty", "qwerty123", "qwertyuiop", "qwerty12345", "asdfghjkl", "zxcvbnm", "1q2w3e4r", "1q2w3e4r5t", "q1w2e3r4",
  "abc123", "abcd1234", "abc12345", "abcdefgh", "abcdefghij", "iloveyou", "letmein", "welcome", "welcome1", "welcome123",
  "admin", "admin123", "administrator", "changeme", "change_me", "default", "master", "login", "secret", "monkey",
  "dragon", "football", "baseball", "sunshine", "princess", "shadow", "superman", "trustno1", "whatever", "freedom",
  "jags", "jagsassurance", "jags123", "jags@123", "jagsqmp", "qmpinspect", "qmp123", "inspect", "inspection", "quality",
  "temp1234", "temporary", "tempPassword", "test1234", "testing123", "guest", "user1234", "passpass",
].map((p) => p.toLowerCase()));

export interface PasswordCheck {
  ok: boolean;
  error: string | null;
}

function isSequentialOrRepeated(pw: string): boolean {
  if (/^(.)\1+$/.test(pw)) return true;
  const sequences = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiopasdfghjklzxcvbnm"];
  const lower = pw.toLowerCase();
  return sequences.some((seq) => seq.includes(lower) || seq.split("").reverse().join("").includes(lower));
}

export function checkPasswordPolicy(password: string, context: { email?: string | null } = {}): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }

  const lower = password.toLowerCase();
  const stripped = lower.replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (COMMON_PASSWORDS.has(lower) || (stripped.length >= 4 && COMMON_PASSWORDS.has(stripped))) {
    return { ok: false, error: "That password is too common. Choose something less guessable." };
  }
  if (isSequentialOrRepeated(password)) {
    return { ok: false, error: "That password is too simple (repeated or sequential characters)." };
  }

  const local = context.email?.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (local && local.length >= 4 && lower.replace(/[^a-z0-9]/g, "").includes(local)) {
    return { ok: false, error: "Your password can't contain your email address." };
  }

  if (new Set(password).size < 4) {
    return { ok: false, error: "Use a wider mix of characters." };
  }

  return { ok: true, error: null };
}
