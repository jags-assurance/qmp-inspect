import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

// Only wraps the build with Sentry's webpack/turbopack plugin (source-map upload, etc.) when a DSN
// is actually configured — the plugin's own source-map-upload step wants an org/project/auth token
// too, none of which exist yet (no Sentry account set up), so wrapping unconditionally could turn a
// plain `next build` into one that warns or fails on missing Sentry credentials. Runtime error
// reporting itself is gated the same way, one level down, in instrumentation.ts/instrumentation-
// client.ts — see those files and docs/INCIDENT_RESPONSE.md for the current (not-yet-active) status.
export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true, disableLogger: true })
  : nextConfig;
