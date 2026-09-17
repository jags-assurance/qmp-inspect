// Deliberately NOT "use server" — these are plain server-only helper functions called directly from
// other server actions and Server Components (lib/signoff/actions.ts, lib/itps/actions.ts,
// lib/ncrs/actions.ts, components/domain/app-shell.tsx), never invoked as a Server Action in their
// own right from a client boundary. A "use server" file requires every export to be a callable
// Server Action; createNotification's first parameter (a live Supabase client instance) isn't
// serializable, which is exactly the kind of shape that only belongs here, not in actions.ts.

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { NOTIFICATIONS_TABLE, type NotificationRow } from "./types";
import { sendNotificationEmail } from "./email";

/**
 * Writes one notification for one recipient, using the SAME supabase client/request context as the
 * calling action so it runs under that user's RLS (notifications_insert only requires org access to
 * the notification's own organization_id — see the migration — not that the caller IS the
 * recipient).
 *
 * Best-effort: a failure here never fails the action that triggered it (e.g. a sign-off still
 * records even if, for some reason, the notification row doesn't) - the underlying business event
 * already happened and is the source of truth; the notification is a convenience layer on top.
 *
 * Also fires an email via Resend when RESEND_API_KEY is configured (see ./email.ts) — genuinely
 * inactive otherwise (no account exists to send from yet), so this never adds a network call in an
 * environment that hasn't set up email. Fire-and-forget: this function does not await the send, so
 * a slow/failed email provider can never make the calling action (sign-off, NCR raise, etc.) hang
 * or fail. Every existing call site of createNotification gets email delivery for free, with no
 * change needed at any of them — this is the single choke point every in-app notification runs
 * through.
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
): Promise<void> {
  await supabase.from(NOTIFICATIONS_TABLE).insert({
    organization_id: params.organizationId,
    project_id: params.projectId ?? null,
    recipient_user_id: params.recipientUserId,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
  });

  if (process.env.RESEND_API_KEY) {
    const { data: recipient } = await supabase
      .from("users")
      .select("email")
      .eq("id", params.recipientUserId)
      .maybeSingle<{ email: string }>();

    if (recipient?.email) {
      sendNotificationEmail({
        toEmail: recipient.email,
        title: params.title,
        body: params.body,
        link: params.link,
      }).catch((err) => {
        console.error(`[notifications] Email send failed for ${params.recipientUserId}:`, err instanceof Error ? err.message : err);
      });
    }
  }
}

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
    .limit(20)
    .returns<NotificationRow[]>();
  return data ?? [];
}
