// Server-side session limits + small signed cookies used by proxy.ts. Pure Web Crypto, so it runs in
// the proxy and in unit tests alike.
//
//  * Absolute lifetime: measured from Supabase's own `last_sign_in_at` (set by the Auth server at
//    sign-in, not by anything the browser can edit). Default 7 days (SESSION_MAX_HOURS).
//  * Inactivity: a signed cookie holds the last time the proxy saw this user; if it is older than the
//    limit (default 12 h, SESSION_INACTIVITY_HOURS) the session is ended server-side. This replaces
//    relying on the browser idle timer alone (it drifts when a tablet sleeps). A request that
//    arrives with no (or an unverifiable) cookie starts a fresh window — the absolute limit above is
//    the hard bound against a stolen cookie jar.
//  * A second signed cookie caches "this user's profile check passed" for a few minutes so the proxy
//    does not query public.users on every request.

const encoder = new TextEncoder();

export interface SessionLimitConfig {
  inactivityMs: number;
  absoluteMs: number;
}

export function readSessionLimitConfig(env: Record<string, string | undefined> = process.env): SessionLimitConfig {
  const hours = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    inactivityMs: hours(env.SESSION_INACTIVITY_HOURS, 12) * 3_600_000,
    absoluteMs: hours(env.SESSION_MAX_HOURS, 24 * 7) * 3_600_000,
  };
}

export type SessionVerdict = "ok" | "idle" | "expired";

export function evaluateSession(params: {
  now: number;
  lastSeen: number | null;
  lastSignInAt: number | null;
  config: SessionLimitConfig;
}): SessionVerdict {
  const { now, lastSeen, lastSignInAt, config } = params;
  if (lastSignInAt !== null && Number.isFinite(lastSignInAt) && now - lastSignInAt > config.absoluteMs) return "expired";
  if (lastSeen !== null && Number.isFinite(lastSeen) && now - lastSeen > config.inactivityMs) return "idle";
  return "ok";
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** `<userId>.<timestampMs>.<hmac>` — binds the timestamp to the user so cookies can't be swapped. */
export async function signStamp(secret: string, userId: string, timestamp: number): Promise<string> {
  const body = `${userId}.${timestamp}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyStamp(secret: string, userId: string, token: string | undefined | null): Promise<number | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uid, ts, sig] = parts;
  if (uid !== userId) return null;
  const expected = await hmac(secret, `${uid}.${ts}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

/** Secret for the cookies above: a dedicated env var, else derived from the service key (server-only). */
export function sessionCookieSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.SESSION_COOKIE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || null;
}
