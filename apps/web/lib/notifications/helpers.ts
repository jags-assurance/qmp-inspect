// Deliberately NOT "use server" — these are plain server-only helper functions called directly from
// other server actions and Server Components (lib/signoff/actions.ts, lib/itps/actions.ts,
// lib/ncrs/actions.ts, components/domain/app-shell.tsx), never invoked as a Server Action in their
// own right from a client boundary. A "use server" file requires every export to be a callable
// Server Action; createNotification's first parameter (a live Supabase client instance) isn't
// serializable, which is exactly the kind of shape that only belongs here, not in actions.ts.

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { NOTIFICATIONS_TABLE, type NotificationRow } from "./types";
import { sendNotificationEmail } from "./email";
import { isUndeliverableAddress } from "./undeliverable";
import { safeSitePath } from "./render";
import { loadEmailOrgBrand } from "./org-brand-email";

/**
 * Writes one notification for one recipient, using the SAME supabase client/request context as the
 * calling action so it runs under that user's RLS (notifications_insert requires that the caller can
 * see the notification's project/organisation, that the RECIPIENT has access to it too, and that the
 * link is a same-site path — see 20261104000300_audit_notifications_hardening_and_email_outbox.sql).
 *
 * Best-effort: a failure here never fails the action that triggered it (e.g. a sign-off still
 * records even if, for some reason, the notification row doesn't) - the underlying business event
 * already happened and is the source of truth; the notification is a convenience layer on top. A
 * refused insert is logged rather than silently dropped.
 *
 * Also emails the recipient via Resend when RESEND_API_KEY is configured (see ./email.ts) — genuinely
 * inactive otherwise. The send runs inside Next's after() so it neither delays the response nor is
 * frozen with the function, and the recipient's address is read with the service role (the caller's
 * own RLS cannot read another user's row, which used to make most emails silently never send).
 * Anything that still fails is retried from email_outbox by the worker (worker/src/emailOutbox.ts).
 */
export async function createNotification(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    organizationId: string;
    projectId?: string | null;
    recipientUserId: string;
    title: string;
    body?: string | null;
    link?: string | null;
  }
): Promise<boolean> {
  // Only a same-site path is ever stored as a link (the bell navigates to it; the DB also checks).
  const link = safeSitePath(params.link);
  // Supplied here (not read back) so the immediate email path can mark the matching outbox row; the
  // caller usually isn't the recipient, so RLS would not let an INSERT ... RETURNING see the row.
  const id = randomUUID();

  const row = {
    id,
    organization_id: params.organizationId,
    project_id: params.projectId ?? null,
    recipient_user_id: params.recipientUserId,
    title: params.title,
    body: params.body ?? null,
    link,
  };
  // One retry: the row id is fixed, so a retry after an ambiguous failure cannot create a duplicate.
  let { error } = await supabase.from(NOTIFICATIONS_TABLE).insert(row);
  if (error) ({ error } = await supabase.from(NOTIFICATIONS_TABLE).insert(row));
  if (error) {
    console.error(`[notifications] insert failed for ${params.recipientUserId}: ${error.message}`);
    return false;
  }

  if (!process.env.RESEND_API_KEY) return true;

  const send = () =>
    sendNotificationEmailNow(supabase, { id, organizationId: params.organizationId, recipientUserId: params.recipientUserId, title: params.title, body: params.body, link });
  try {
    after(send);
  } catch {
    // Called outside a request scope (script / test): just run it inline.
    await send();
  }
  return true;
}

async function sendNotificationEmailNow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  n: { id: string; organizationId?: string | null; recipientUserId: string; title: string; body?: string | null; link: string | null }
): Promise<void> {
  try {
    const service = isServiceRoleConfigured() ? createSupabaseServiceRoleClient() : null;
    const { data: recipient } = await (service ?? supabase)
      .from("users")
      .select("email")
      .eq("id", n.recipientUserId)
      .maybeSingle<{ email: string }>();
    if (!recipient?.email) return;
    if (isUndeliverableAddress(recipient.email)) {
      // Test/demo address: never a real mailbox. Mark it skipped so the worker does not retry it either.
      if (service) {
        await service
          .from("email_outbox" as never)
          .update({ status: "skipped", last_error: "Skipped: test/demo recipient address (not a real mailbox)" } as never)
          .eq("notification_id", n.id)
          .eq("status", "pending");
      }
      return;
    }

    await sendNotificationEmail({ toEmail: recipient.email, title: n.title, body: n.body, link: n.link, brand: await loadEmailOrgBrand(n.organizationId) });

    if (service) {
      // Mark the outbox row sent so the worker doesn't send it again (the table may not exist yet).
      await service
        .from("email_outbox" as never)
        .update({ status: "sent", sent_at: new Date().toISOString() } as never)
        .eq("notification_id", n.id);
    }
  } catch (err) {
    console.error(`[notifications] Email send failed for ${n.recipientUserId}:`, err instanceof Error ? err.message : err);
  }
}

export const RECENT_NOTIFICATIONS_LIMIT = 20;

/** Initial server-rendered load for the bell — the client component then keeps this list live via Realtime. */
export async function listRecentNotifications(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string
): Promise<NotificationRow[]> {
  const { data } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .select("*")
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_NOTIFICATIONS_LIMIT)
    .returns<NotificationRow[]>();
  return data ?? [];
}
