// Pure logic for email transmittals (S7-26): recipient parsing, what may be sent, the email content.
// No server-only imports, so it unit-tests cleanly (see __tests__/logic.test.ts).

import { escapeHtml, safeSitePath } from "@/lib/notifications/render";

export const MAX_TRANSMITTAL_RECIPIENTS = 10;
export const MAX_TRANSMITTAL_MESSAGE_LENGTH = 2000;

export type TransmittalEntityType = "vault_document" | "data_book";

export const TRANSMITTALS_TABLE = "document_transmittals";

export interface TransmittalRow {
  id: string;
  batch_id: string;
  entity_type: TransmittalEntityType;
  entity_id: string;
  entity_label: string;
  recipient_email: string;
  subject: string;
  message: string | null;
  status: "queued" | "sent" | "failed";
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  users?: { full_name: string } | null;
}

// Deliberately simple: one @, no whitespace / angle brackets / separators, a dot in the domain. The
// database repeats this check; real validation is the mail provider accepting the address.
const EMAIL_PATTERN = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

export function isValidEmail(value: string): boolean {
  return value.length >= 3 && value.length <= 254 && EMAIL_PATTERN.test(value);
}

export interface ParsedRecipients {
  /** Valid, lower-cased, de-duplicated addresses in the order given. */
  valid: string[];
  invalid: string[];
  duplicates: string[];
}

/** Splits free text (commas, semicolons, spaces, newlines) into addresses and classifies each. */
export function parseRecipients(text: string | null | undefined): ParsedRecipients {
  const tokens = (text ?? "")
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!isValidEmail(token)) {
      invalid.push(token);
      continue;
    }
    const email = token.toLowerCase();
    if (seen.has(email)) {
      duplicates.push(email);
      continue;
    }
    seen.add(email);
    valid.push(email);
  }
  return { valid, invalid, duplicates };
}

/** Only an approved vault document or an issued Data Book is "issued" and may be transmitted. */
export function canTransmit(entityType: TransmittalEntityType, status: string | null | undefined): boolean {
  if (entityType === "vault_document") return status === "approved";
  return status === "issued";
}

export function transmittalLinkPath(entityType: TransmittalEntityType, projectId: string, entityId: string): string {
  return entityType === "vault_document" ? `/inspect/vault/${projectId}/document/${entityId}` : `/inspect/projects/${projectId}/data-book`;
}

export interface TransmittalInput {
  recipientsText: string;
  message: string;
}

export type TransmittalValidation =
  | { ok: true; recipients: string[]; message: string | null; warnings: string[] }
  | { ok: false; error: string };

/** Validates the form input; returns the cleaned recipient list or a single user-facing error. */
export function validateTransmittalInput(input: TransmittalInput): TransmittalValidation {
  const { valid, invalid, duplicates } = parseRecipients(input.recipientsText);
  if (invalid.length > 0) {
    return { ok: false, error: `These do not look like email addresses: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? "…" : ""}.` };
  }
  if (valid.length === 0) return { ok: false, error: "Enter at least one recipient email address." };
  if (valid.length > MAX_TRANSMITTAL_RECIPIENTS) {
    return { ok: false, error: `You can send to at most ${MAX_TRANSMITTAL_RECIPIENTS} recipients at a time.` };
  }
  const message = input.message.trim();
  if (message.length > MAX_TRANSMITTAL_MESSAGE_LENGTH) {
    return { ok: false, error: `The message must be ${MAX_TRANSMITTAL_MESSAGE_LENGTH} characters or fewer.` };
  }
  return {
    ok: true,
    recipients: valid,
    message: message || null,
    warnings: duplicates.length > 0 ? [`Ignored ${duplicates.length} repeated address${duplicates.length === 1 ? "" : "es"}.`] : [],
  };
}

/** "Document transmittal: <label>", single line and bounded, since the label is user-influenced text. */
export function buildTransmittalSubject(entityLabel: string): string {
  const label = entityLabel.replace(/[\r\n]+/g, " ").trim();
  return `Document transmittal: ${label}`.slice(0, 300);
}

/**
 * HTML body of the transmittal email. Everything user-influenced (label, sender, message) is escaped,
 * and the link is only ever a same-site path joined to the configured app URL. The link needs a
 * sign-in: recipients get access to the document through their account, never through an open URL.
 */
export function renderTransmittalEmailHtml(params: {
  entityLabel: string;
  entityKind: string;
  senderName: string;
  message: string | null;
  linkPath: string;
  appUrl: string;
}): string {
  const base = params.appUrl.replace(/\/+$/, "");
  const path = safeSitePath(params.linkPath);
  const link = path && base ? `<p><a href="${escapeHtml(base + path)}">Open ${escapeHtml(params.entityKind)} in JAGS Assurance &rarr;</a></p>` : "";
  const note = params.message ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #b3a993;white-space:pre-wrap">${escapeHtml(params.message)}</blockquote>` : "";
  return (
    `<p>${escapeHtml(params.senderName)} has sent you the ${escapeHtml(params.entityKind)} <strong>${escapeHtml(params.entityLabel)}</strong>.</p>` +
    note +
    link +
    `<p style="color:#5c5648;font-size:12px">You need to sign in to JAGS Assurance to open it. If you were not expecting this email you can ignore it.</p>`
  );
}

/** Label shown in the transmittal log. */
export function transmittalStatusLabel(status: TransmittalRow["status"]): string {
  return status === "sent" ? "Sent" : status === "failed" ? "Failed" : "Queued";
}
