// Security response headers (E-06). Pure so it can be unit-tested and reused by next.config.ts.

export interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Report-only CSP first: it shows what a strict policy would block (browser console / report-uri)
 * without breaking pages. Next injects inline scripts for hydration, so script-src keeps
 * 'unsafe-inline' until a nonce-based policy is rolled out; frame-ancestors, object-src, base-uri
 * and form-action are already strict.
 */
export function buildCsp(supabaseUrl: string | undefined): string {
  const supabase = supabaseUrl ? [supabaseUrl, supabaseUrl.replace(/^http/, "ws")] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
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

export function securityHeaders(env: { supabaseUrl?: string; isProduction: boolean }): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Content-Security-Policy-Report-Only", value: buildCsp(env.supabaseUrl) },
  ];
  if (env.isProduction) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
