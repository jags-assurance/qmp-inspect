// S7-26: retry policy for transmittal emails in email_outbox. Pure (no database / env access) so it
// unit-tests cleanly; the sweep that uses it lives in emailOutbox.ts.

/** After this many failed attempts (the web app's immediate send counts as the first) the email is given up on. */
export const MAX_TRANSMITTAL_ATTEMPTS = 5;

const MINUTE_MS = 60_000;
/** Wait before attempt N+1, indexed by attempts already made (1-based): 5 min, 15 min, 1 h, 4 h. */
const BACKOFF_MS = [5 * MINUTE_MS, 15 * MINUTE_MS, 60 * MINUTE_MS, 240 * MINUTE_MS];

export function transmittalRetryDelayMs(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

export interface OutboxState {
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
}

/** Whether the worker should try to send this outbox row now. */
export function isTransmittalDue(row: OutboxState, now: number): boolean {
  if (row.status !== "pending") return false;
  if (row.attempts >= MAX_TRANSMITTAL_ATTEMPTS) return false;
  if (!row.nextAttemptAt) return true;
  const at = Date.parse(row.nextAttemptAt);
  return !Number.isFinite(at) || at <= now;
}

export interface FailureOutcome {
  status: "pending" | "failed";
  attempts: number;
  /** Set while the row stays pending. */
  nextAttemptAt: string | null;
}

/** What to record after a failed send attempt. */
export function outcomeAfterFailure(attemptsBefore: number, now: number): FailureOutcome {
  const attempts = attemptsBefore + 1;
  if (attempts >= MAX_TRANSMITTAL_ATTEMPTS) return { status: "failed", attempts, nextAttemptAt: null };
  return { status: "pending", attempts, nextAttemptAt: new Date(now + transmittalRetryDelayMs(attempts)).toISOString() };
}

/** Error text stored on the rows: bounded, single line, no key material. */
export function sanitizeEmailError(message: string): string {
  return message.replace(/\s+/g, " ").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]").replace(/https?:\/\/\S*token=\S*/gi, "[redacted-url]").slice(0, 500);
}

// M5: time-limited download links. The stored body_html holds only this placeholder; the worker (and the
// web app's first attempt) generate a 7-day signed storage URL at SEND time and substitute it, so retries
// never carry an expired link and the URL is never stored or logged. Keep in sync with
// apps/web/lib/transmittals/logic.ts.
export const TRANSMITTAL_DOWNLOAD_PLACEHOLDER = "<!--TRANSMITTAL_DOWNLOAD-->";
export const TRANSMITTAL_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Only approved vault documents and issued Data Books may be sent. */
export function canSignTransmittal(entityType: string, status: string | null | undefined): boolean {
  if (entityType === "vault_document") return status === "approved";
  if (entityType === "data_book") return status === "issued";
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function renderDownloadBlock(params: { signedUrl: string | null; verifyUrl: string | null; entityKind: string }): string {
  const signed = safeHttpsUrl(params.signedUrl);
  const verify = safeHttpsUrl(params.verifyUrl);
  if (!signed && !verify) return "";
  const parts: string[] = [];
  if (signed) {
    parts.push(
      `<p><a href="${escapeHtml(signed)}">Download the ${escapeHtml(params.entityKind)} (PDF)</a></p>` +
        `<p style="color:#5c5648;font-size:12px">This download link works without signing in and expires in 7 days. Do not forward it to people who should not have the document.</p>`
    );
  }
  if (verify) parts.push(`<p><a href="${escapeHtml(verify)}">Verify this document's authenticity</a></p>`);
  return parts.join("");
}

export function injectDownloadBlock(html: string, block: string): string {
  return html.split(TRANSMITTAL_DOWNLOAD_PLACEHOLDER).join(block);
}
