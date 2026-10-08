import { supabase } from "./supabase";
import { MAX_TRANSMITTAL_ATTEMPTS, isTransmittalDue, outcomeAfterFailure, sanitizeEmailError } from "./transmittalEmailPolicy";

// email_outbox / document_transmittals aren't in the generated Database type (same documented escape
// hatch as automation.ts and index.ts's background_jobs handle).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const db = supabase as any;

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = process.env.NOTIFICATIONS_EMAIL_FROM ?? "JAGS Assurance <notifications@jagsassurance.com>";
const BATCH = 20;

interface OutboxRow {
  id: string;
  transmittal_id: string;
  recipient_email: string;
  subject: string;
  body_html: string;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
}

let warnedNoKey = false;

async function sendViaResend(row: OutboxRow, apiKey: string): Promise<void> {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: row.recipient_email, subject: row.subject, html: row.body_html }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Resend API returned ${response.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * S7-26: sends transmittal emails the web app could not (or did not finish) sending, with backoff, and
 * mirrors the result onto the document_transmittals log row. Only rows with a transmittal_id are touched:
 * notification emails keep their own path. A no-op without RESEND_API_KEY. Returns how many were sent.
 * Needs migration 20261112000102; until then the query errors and the sweep quietly does nothing.
 */
export async function sweepTransmittalOutbox(): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (!warnedNoKey) {
      console.log("[worker] RESEND_API_KEY not set: transmittal emails will not be retried by the worker.");
      warnedNoKey = true;
    }
    return 0;
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("email_outbox")
    .select("id, transmittal_id, recipient_email, subject, body_html, status, attempts, next_attempt_at")
    .eq("status", "pending")
    .not("transmittal_id", "is", null)
    .lte("next_attempt_at", nowIso)
    .lt("attempts", MAX_TRANSMITTAL_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH);
  if (error) return 0;

  let sent = 0;
  for (const row of (data ?? []) as OutboxRow[]) {
    const now = Date.now();
    if (!isTransmittalDue({ status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at }, now)) continue;
    try {
      await sendViaResend(row, apiKey);
      const sentAt = new Date().toISOString();
      // Conditioned on 'pending' so a send racing the web app's own after() path cannot be recorded twice.
      await db.from("email_outbox").update({ status: "sent", sent_at: sentAt, attempts: row.attempts + 1, last_error: null }).eq("id", row.id).eq("status", "pending");
      await db.from("document_transmittals").update({ status: "sent", sent_at: sentAt, last_error: null }).eq("id", row.transmittal_id);
      sent += 1;
    } catch (err) {
      const message = sanitizeEmailError(err instanceof Error ? err.message : String(err));
      const outcome = outcomeAfterFailure(row.attempts, now);
      console.error(`[worker] transmittal email ${row.id} failed (attempt ${outcome.attempts}): ${message}`);
      await db
        .from("email_outbox")
        .update({
          status: outcome.status,
          attempts: outcome.attempts,
          last_error: message,
          ...(outcome.nextAttemptAt ? { next_attempt_at: outcome.nextAttemptAt } : {}),
        })
        .eq("id", row.id)
        .eq("status", "pending");
      if (outcome.status === "failed") {
        await db.from("document_transmittals").update({ status: "failed", last_error: message }).eq("id", row.transmittal_id);
      }
    }
  }
  return sent;
}
