// Client-side Sentry setup — Next.js 16 looks for this exact filename (not the older
// sentry.client.config.ts wizard convention) to auto-load browser-side instrumentation. Gated on
// NEXT_PUBLIC_SENTRY_DSN (must be NEXT_PUBLIC_-prefixed to reach the browser bundle at all — the
// plain SENTRY_DSN used by the server/edge configs never does) — see sentry.server.config.ts for
// why this stays a true no-op until a real Sentry project exists.
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
