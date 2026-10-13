import { supabase } from "./supabase";
import { pastHeadStart, renderNotificationEmailHtml, resolveRecipient } from "./notificationEmail";
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

interface NotificationOutboxRow {
  id: string;
  notification_id: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  created_at: string | null;
}

/**
 * Retries notification emails the web app's after() path did not deliver. These outbox rows carry no
 * subject/body: both are rebuilt from the notifications row (title, body, link) exactly as the web path
 * does, and the address comes from the row or, when null, from public.users. Inactive users are marked
 * skipped. Rows younger than the 2-minute head start are left alone so this never races the immediate
 * send. Same backoff and conditional-on-pending updates as the transmittal sweep.
 */
export async function sweepNotificationOutbox(): Promise<number> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return 0;

  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("email_outbox")
    .select("id, notification_id, recipient_user_id, recipient_email, status, attempts, next_attempt_at, created_at")
    .eq("status", "pending")
    .not("notification_id", "is", null)
    .is("transmittal_id", null)
    .lte("next_attempt_at", nowIso)
    .lt("attempts", MAX_TRANSMITTAL_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH);
  if (error) return 0;

  const appUrl = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  let sent = 0;
  for (const row of (data ?? []) as NotificationOutboxRow[]) {
    const now = Date.now();
    if (!isTransmittalDue({ status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at }, now)) continue;
    if (!pastHeadStart(row.created_at, now)) continue;
    try {
      const { data: n } = await db.from("notifications").select("title, body, link").eq("id", row.notification_id).maybeSingle();
      if (!n) {
        await db.from("email_outbox").update({ status: "skipped", last_error: "notification no longer exists" }).eq("id", row.id).eq("status", "pending");
        continue;
      }
      let user: { email: string | null; is_active: boolean } | null = null;
      if (row.recipient_user_id) {
        const res = await db.from("users").select("email, is_active").eq("id", row.recipient_user_id).maybeSingle();
        user = res.data ?? null;
      }
      const decision = resolveRecipient(row.recipient_email, user);
      if (!decision.send) {
        await db.from("email_outbox").update({ status: "skipped", last_error: decision.reason }).eq("id", row.id).eq("status", "pending");
        continue;
      }
      await sendViaResend(
        {
          id: row.id,
          transmittal_id: "",
          recipient_email: decision.email,
          subject: n.title,
          body_html: renderNotificationEmailHtml({ title: n.title, body: n.body, link: n.link, appUrl }),
          status: row.status,
          attempts: row.attempts,
          next_attempt_at: row.next_attempt_at,
        },
        apiKey
      );
      await db
        .from("email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null })
        .eq("id", row.id)
        .eq("status", "pending");
      sent += 1;
    } catch (err) {
      const message = sanitizeEmailError(err instanceof Error ? err.message : String(err));
      const outcome = outcomeAfterFailure(row.attempts, now);
      console.error(`[worker] notification email ${row.id} failed (attempt ${outcome.attempts}): ${message}`);
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
    }
  }
  return sent;
}
