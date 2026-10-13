// Pure rendering/eligibility for notification emails retried by the worker. Mirrors
// apps/web/lib/notifications/render.ts (the worker cannot import from apps/web); keep the two in step.

/** The web app's immediate send gets this head start before the worker may pick a notification row up. */
export const NOTIFICATION_HEAD_START_MS = 2 * 60_000;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function safeSitePath(link: string | null | undefined): string | null {
  if (!link) return null;
  if (!link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(link)) return null;
  return link;
}

export function renderNotificationEmailHtml(params: { title: string; body?: string | null; link?: string | null; appUrl: string }): string {
  const text = escapeHtml(params.body?.trim() ? params.body : params.title);
  const path = safeSitePath(params.link);
  const base = params.appUrl.replace(/\/+$/, "");
  const linkHtml = path && base ? `<p><a href="${escapeHtml(base + path)}">Open in JAGS Assurance &rarr;</a></p>` : "";
  return `<p>${text}</p>${linkHtml}`;
}

/** Whether a pending notification outbox row is old enough for the worker to take over from the web app. */
export function pastHeadStart(createdAt: string | null | undefined, now: number): boolean {
  if (!createdAt) return true;
  const at = Date.parse(createdAt);
  return !Number.isFinite(at) || now - at >= NOTIFICATION_HEAD_START_MS;
}

/** Mirror of apps/web/lib/notifications/undeliverable.ts: reserved/test domains can never be a real mailbox. */
export function isUndeliverableAddress(email: string | null | undefined): boolean {
  const trimmed = (email ?? "").trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return true;
  const domain = trimmed.slice(at + 1);
  if (!domain || !domain.includes(".")) return true;
  return /\.(local|localhost|demo|test|invalid|example)$/.test(domain) || /^example\.[a-z]+$/.test(domain);
}

export type RecipientDecision = { send: true; email: string } | { send: false; reason: string };

/** Decides whether (and where) to send; there is no email-preference column, so only is_active and an address matter. */
export function resolveRecipient(
  rowEmail: string | null | undefined,
  user: { email: string | null; is_active: boolean } | null | undefined
): RecipientDecision {
  if (user && user.is_active === false) return { send: false, reason: "recipient user is inactive" };
  const email = rowEmail?.trim() || user?.email?.trim() || "";
  if (!email) return { send: false, reason: "no recipient email address" };
  if (isUndeliverableAddress(email)) return { send: false, reason: "test/demo recipient address (not a real mailbox)" };
  return { send: true, email };
}
