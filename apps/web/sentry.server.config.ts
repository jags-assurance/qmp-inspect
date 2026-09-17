// Server-side Sentry setup, imported conditionally from instrumentation.ts.
//
// Gated on SENTRY_DSN so this stays a true no-op until a real Sentry project exists: no DSN means
// Sentry.init() below is never called at all (not just "called with an empty dsn"), so there is
// zero behavior change — no crash, no console noise — for every environment until someone sets
// SENTRY_DSN in Railway/Vercel. See docs/INCIDENT_RESPONSE.md for the current (not-yet-active)
// error-tracking status.
import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}
