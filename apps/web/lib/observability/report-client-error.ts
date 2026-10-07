"use client";

// Sends an error caught by an error boundary to Sentry when (and only when) a browser DSN is
// configured. Mirrors instrumentation-client.ts: dynamic import so the SDK is not in the bundle
// otherwise. Always also logs to the console.
export function reportClientError(error: unknown): void {
  console.error(error);
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
  }
}
