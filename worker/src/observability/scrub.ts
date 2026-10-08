// PII scrubbing for error reports (E-08). Plain module so the server, edge and browser Sentry configs
// and the unit tests share it. Error text in this app often embeds names, emails and free text typed
// by users, so every string is passed through redactText and request/user context is dropped.
//
// This file is a deliberate copy of apps/web/lib/observability/scrub.ts (the worker cannot import from
// apps/web at build time); worker/__tests__/scrub.test.ts fails if the two drift apart.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{10,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
// key=value / key: value pairs that carry a credential (query strings, signed storage URLs, form bodies).
const SECRET_PARAM_RE =
  /\b(token|token_hash|access_token|refresh_token|id_token|apikey|api_key|api-key|password|passwd|secret|signature|sig)=([^&\s"'<>]+)/gi;
// Public QR verification links carry an unguessable token as the last path segment: /verify/<kind>/<token>.
const VERIFY_PATH_RE = /(\/verify\/[A-Za-z0-9_-]+\/)[A-Za-z0-9_-]{8,}/g;
// Supabase auth cookies: sb-<project-ref>-auth-token(.0/.1).
const SB_COOKIE_RE = /\bsb-[a-z0-9]+-auth-token(?:\.\d+)?=[^;\s]+/gi;

export function redactText(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(BEARER_RE, "Bearer [token]")
    .replace(JWT_RE, "[jwt]")
    .replace(SB_COOKIE_RE, "[auth-cookie]")
    .replace(SECRET_PARAM_RE, "$1=[redacted]")
    .replace(VERIFY_PATH_RE, "$1[token]");
}

/** A URL with its query string and fragment removed and any verification token path segment masked. */
export function scrubUrl(url: string): string {
  return redactText(url.split("#")[0].split("?")[0]);
}

interface LooseFrame {
  vars?: unknown;
}

interface LooseEvent {
  message?: string;
  transaction?: string;
  server_name?: string;
  user?: unknown;
  request?: { headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown; url?: string };
  exception?: { values?: { value?: string; stacktrace?: { frames?: LooseFrame[] } }[] };
  breadcrumbs?: unknown;
  extra?: unknown;
  contexts?: Record<string, unknown>;
  spans?: { description?: string; data?: Record<string, unknown> }[];
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction`: strips user, cookies, headers, bodies, local
 * variables, breadcrumbs and obvious secrets/emails from every text field we can reach.
 */
export function scrubEvent<T extends LooseEvent>(event: T): T {
  if (event.message) event.message = redactText(event.message);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const v of event.exception?.values ?? []) {
    if (v.value) v.value = redactText(v.value);
    // Captured local variables can hold anything (form values, rows); never send them.
    for (const frame of v.stacktrace?.frames ?? []) delete frame.vars;
  }
  delete event.user;
  delete event.extra;
  delete event.server_name;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
  }
  if (event.contexts) delete event.contexts.request;
  for (const span of event.spans ?? []) {
    if (span.description) span.description = redactText(span.description);
    if (span.data) {
      for (const key of Object.keys(span.data)) {
        const value = span.data[key];
        if (typeof value === "string") span.data[key] = /url|query|path|target/i.test(key) ? scrubUrl(value) : redactText(value);
      }
    }
  }
  event.breadcrumbs = [];
  return event;
}

/** Sentry `beforeBreadcrumb`: breadcrumbs (console output, fetch URLs, clicks) are not needed and often carry PII. */
export function dropBreadcrumb(): null {
  return null;
}
