// Edge-runtime Sentry setup (middleware, edge routes), imported conditionally from
// instrumentation.ts. Gated on SENTRY_DSN — see sentry.server.config.ts for why.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observability/scrub";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
}
