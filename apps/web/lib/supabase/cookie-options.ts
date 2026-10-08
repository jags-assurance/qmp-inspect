/**
 * Cookie attributes for the Supabase auth session, shared by the server client, the proxy and the
 * browser client so all three agree. `secure` is on in production (HTTPS only). The cookie is
 * deliberately NOT HttpOnly: the browser client reads the session for Storage uploads and Realtime;
 * marking it HttpOnly would break those, and the session is protected instead by SameSite=Lax,
 * short-lived access tokens, rotating refresh tokens and the strict CSP.
 */
export const SUPABASE_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
