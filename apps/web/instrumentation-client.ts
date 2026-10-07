// Client-side Sentry setup — Next.js 16 looks for this exact filename (not the older
// sentry.client.config.ts wizard convention) to auto-load browser-side instrumentation. Gated on
// NEXT_PUBLIC_SENTRY_DSN (must be NEXT_PUBLIC_-prefixed to reach the browser bundle at all — the
// plain SENTRY_DSN used by the server/edge configs never does) — see sentry.server.config.ts for
// why this stays a true no-op until a real Sentry project exists.
//
// Loaded with a dynamic import INSIDE the DSN check, not a top-level `import * as Sentry`: the SDK
// (with browser tracing) was ~140 KB gzip, shipped to every page and parsed before first paint
// even though it did nothing without a DSN. NEXT_PUBLIC_* is inlined at build time, so with no DSN
// the bundler drops this whole branch — the SDK is not in the bundle at all — and with a DSN it
// becomes an async chunk fetched after the page is already interactive. The trade-off: an error
// thrown in the first moments before that chunk arrives isn't captured.
import { scrubEvent } from "@/lib/observability/scrub";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend: (event) => scrubEvent(event),
    });
  });
}
