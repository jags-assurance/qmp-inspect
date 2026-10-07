import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1 MB body; forms that post photos (NCR raise, punch add/resolve) need
    // more. 4 MB stays under the ~4.5 MB serverless request cap on Vercel — the forms compress photos
    // client-side (lib/media/compress-image) so a handful of photos fits.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          isProduction: process.env.NODE_ENV === "production",
        }),
      },
    ];
  },
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
