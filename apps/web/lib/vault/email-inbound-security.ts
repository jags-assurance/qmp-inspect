// Pure security helpers for the inbound-email webhook (app/api/vault/email-inbound/route.ts).

import { timingSafeEqual } from "node:crypto";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_EMAIL = 10;

const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/plain",
  "text/csv",
  "application/octet-stream", // providers often label unknown types this way; extension is checked too
]);
const BLOCKED_EXTENSIONS = new Set(["exe", "bat", "cmd", "com", "scr", "js", "vbs", "msi", "dll", "sh", "ps1", "jar", "html", "htm", "svg"]);

/** Constant-time string comparison (different lengths compare false without leaking where). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison so timing does not depend on the length mismatch alone.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Header-only secret: `x-vault-webhook-secret` or `Authorization: Bearer`. Never the query string. */
export function extractWebhookSecret(headers: { get(name: string): string | null }): string | null {
  const header = headers.get("x-vault-webhook-secret");
  if (header) return header;
  const auth = headers.get("authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

/** "Jane <jane@x.com>" -> "jane@x.com" (lower-cased); null when no address is present. */
export function extractEmailAddress(from: string): string | null {
  const m = from.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/**
 * A sender is accepted when it is one of the project parties' contact / linked-user emails, shares
 * an email domain with one of them, or appears in the explicit allowlist (VAULT_EMAIL_ALLOWED_SENDERS,
 * comma-separated addresses or "@domain" entries). Free-mail domains never match by domain alone.
 */
const FREE_MAIL = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "proton.me", "protonmail.com"]);

export function isSenderAllowed(fromHeader: string, partyEmails: string[], extraAllowlist: string[] = []): boolean {
  const sender = extractEmailAddress(fromHeader);
  if (!sender) return false;
  const senderDomain = sender.split("@")[1];
  const parties = partyEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (parties.includes(sender)) return true;
  if (!FREE_MAIL.has(senderDomain) && parties.some((p) => p.split("@")[1] === senderDomain)) return true;
  return extraAllowlist
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith("@") ? senderDomain === entry.slice(1) : entry === sender));
}

export function validateAttachment(filename: string, contentType: string | null, byteLength: number): string | null {
  if (byteLength <= 0) return "Empty attachment.";
  if (byteLength > MAX_ATTACHMENT_BYTES) return `Attachment exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.has(ext)) return `File type .${ext} is not accepted.`;
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type && !ALLOWED_MIME.has(type) && !ALLOWED_MIME_PREFIXES.some((p) => type.startsWith(p))) {
    return `Content type ${type} is not accepted.`;
  }
  if (type === "image/svg+xml") return "SVG attachments are not accepted.";
  return null;
}

/**
 * Provider-reported SPF result, when the webhook includes the message headers (Postmark sends
 * `Headers: [{Name, Value}]`, including Received-SPF). A fail/softfail means the From address was not
 * sent by an authorised server: treat as spoofed. Missing headers are not a failure (provider-dependent).
 */
export function senderAuthenticationFailed(body: unknown): boolean {
  const headers = (body as { Headers?: unknown } | null)?.Headers;
  if (!Array.isArray(headers)) return false;
  for (const h of headers) {
    const name = String((h as { Name?: unknown })?.Name ?? "").toLowerCase();
    const value = String((h as { Value?: unknown })?.Value ?? "").trim().toLowerCase();
    if (name === "received-spf" && (value.startsWith("fail") || value.startsWith("softfail"))) return true;
    if (name === "authentication-results" && /\b(spf|dkim)=fail\b/.test(value)) return true;
  }
  return false;
}

export type InboundDecision = { accept: true } | { accept: false; reason: string };

/** Accept only recognised senders whose authentication did not fail; everything else is quarantined. */
export function decideInbound(params: {
  from: string;
  partyEmails: string[];
  extraAllowlist: string[];
  body: unknown;
}): InboundDecision {
  if (!isSenderAllowed(params.from, params.partyEmails, params.extraAllowlist)) {
    return { accept: false, reason: "Sender is not a recognised contact for this project" };
  }
  if (senderAuthenticationFailed(params.body)) {
    return { accept: false, reason: "Sender failed SPF/DKIM authentication (possible spoofing)" };
  }
  return { accept: true };
}
