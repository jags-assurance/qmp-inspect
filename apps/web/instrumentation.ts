// Next.js instrumentation hook (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
// Loads the per-runtime Sentry config, and reports errors caught by Next's own
// `onRequestError` hook — both are no-ops until SENTRY_DSN is set (see sentry.server.config.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (
  ...args: Parameters<
    typeof import("@sentry/nextjs").captureRequestError
  >
) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
