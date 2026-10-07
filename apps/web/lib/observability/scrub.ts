// PII scrubbing for error reports. Plain module so the server, edge and browser Sentry configs and
// the unit tests share it. Error text in this app often embeds names, emails and free text typed by
// users, so every string is passed through redactText and request/user context is dropped.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{10,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;

export function redactText(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(BEARER_RE, "Bearer [token]").replace(JWT_RE, "[jwt]");
}

interface LooseEvent {
  message?: string;
  user?: unknown;
  request?: { headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown; url?: string };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: unknown;
  extra?: unknown;
}

/** Sentry `beforeSend`: strips user, cookies, headers, bodies and obvious secrets/emails from text. */
export function scrubEvent<T extends LooseEvent>(event: T): T {
  if (event.message) event.message = redactText(event.message);
  for (const v of event.exception?.values ?? []) {
    if (v.value) v.value = redactText(v.value);
  }
  delete event.user;
  delete event.extra;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
  }
  event.breadcrumbs = [];
  return event;
}
