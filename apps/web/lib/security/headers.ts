// Security response headers (E-06). Pure so it can be unit-tested and reused by next.config.ts.

export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * The enforced CSP. Next injects inline scripts for hydration, so script-src keeps 'unsafe-inline'
 * until a nonce-based policy is rolled out; frame-ancestors, object-src, base-uri and form-action are
 * strict. `allowEval: false` builds the stricter variant that is shipped Report-Only next to the
 * enforced one, so a later tightening can be checked against real traffic first.
 */
export function buildCsp(supabaseUrl: string | undefined, options: { allowEval?: boolean } = {}): string {
  const allowEval = options.allowEval ?? true;
  const supabase = supabaseUrl ? [supabaseUrl, supabaseUrl.replace(/^http/, "ws")] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(allowEval ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "img-src": ["'self'", "data:", "blob:", ...supabase.slice(0, 1)],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "connect-src": ["'self'", ...supabase, "https://*.ingest.sentry.io", "https://*.ingest.de.sentry.io"],
    "media-src": ["'self'", "blob:", ...supabase.slice(0, 1)],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'self'", ...supabase.slice(0, 1)],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * `enforce: false` (set CSP_REPORT_ONLY=1 in the environment) serves the policy as Report-Only again.
 * That is the switch to flip if an enforced directive ever blocks something real.
 */
export function securityHeaders(env: { supabaseUrl?: string; isProduction: boolean; enforceCsp?: boolean }): HeaderEntry[] {
  const enforce = env.enforceCsp ?? true;
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
      value: buildCsp(env.supabaseUrl),
    },
  ];
  // Stricter candidate (no 'unsafe-eval'), observed only, in production where Next does not need eval.
  if (enforce && env.isProduction) {
    headers.push({ key: "Content-Security-Policy-Report-Only", value: buildCsp(env.supabaseUrl, { allowEval: false }) });
  }
  if (env.isProduction) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
