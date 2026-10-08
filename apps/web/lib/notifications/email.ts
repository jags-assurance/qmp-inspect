// Real email delivery for notifications — genuinely inactive until RESEND_API_KEY is set, same
// scaffolding pattern as Sentry (see apps/web/instrumentation.ts): every call site checks the env
// var itself, so a DSN-less/key-less environment produces zero network calls, not a silent
// failure. Before this file existed, `createNotification` (helpers.ts) only ever wrote an in-app
// DB row — nothing was ever actually delivered to anyone who wasn't already looking at the app,
// which is the CEO-flagged gap: "notifications must ensure fast turnaround" needs a channel that
// reaches someone who ISN'T currently in the app.
//
// Uses Resend's plain HTTP API via fetch rather than adding the `resend` npm package — one POST
// request, no SDK needed, keeps this dependency-free until there's a second reason to add the SDK.

import { renderNotificationEmailHtml } from "./render";

const RESEND_API_URL = "https://api.resend.com/emails";

// Must be a domain verified in the Resend account this key belongs to — resend.com rejects sends
// from an unverified From address. Overridable via env for whoever sets up the real account.
const DEFAULT_FROM = process.env.NOTIFICATIONS_EMAIL_FROM ?? "JAGS Assurance <notifications@jagsassurance.com>";

export interface NotificationEmailParams {
  toEmail: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Sends one notification email via Resend. Callers must check `process.env.RESEND_API_KEY`
 * themselves before calling this (see createNotification in helpers.ts) — this function assumes
 * it's already configured and throws on a missing key rather than silently no-op'ing, so a caller
 * that forgets the gate fails loudly in development instead of masking the bug.
 *
 * Best-effort by design: every call site wraps this in a .catch() that only logs — a failed email
 * send must never fail the business action (sign-off, NCR raise, etc.) that triggered it. The
 * in-app notification row (already written by createNotification before this runs) remains the
 * source of truth regardless of whether the email itself succeeds.
 */
export async function sendNotificationEmail(params: NotificationEmailParams): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  // Title, body and link are user-influenced (party names, NCR text, reasons): escaped, and the link
  // is only ever a same-site path — see ./render.ts.
  const html = renderNotificationEmailHtml({ title: params.title, body: params.body, link: params.link, appUrl });
  await sendEmail({ toEmail: params.toEmail, subject: params.title, html });
}

/**
 * Sends one already-rendered HTML email via Resend. Shared by notification emails and document
 * transmittals (S7-26). Like sendNotificationEmail it throws on a missing RESEND_API_KEY rather than
 * silently doing nothing, so a caller that forgot to gate on it fails loudly.
 */
export async function sendEmail(params: { toEmail: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("sendEmail called without RESEND_API_KEY set — caller should have gated this.");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to: params.toEmail,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Resend API returned ${response.status}: ${text.slice(0, 500)}`);
  }
}
