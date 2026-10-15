"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/notifications/actions";
import type { NotificationRow } from "@/lib/notifications/types";
import { safeSitePath } from "@/lib/notifications/render";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Real notifications, live — replaces the previous static bell (a hardcoded dot, no data behind it).
 * Seeded from the server with this user's most recent rows, then kept current via a Supabase
 * Realtime subscription on the notifications table filtered to this user's own recipient_user_id —
 * so a sign-off Notify or an ITP reaching Approved shows up here without the recipient reloading
 * anything, which is the actual point of a multi-party workflow where different people are looking
 * at their own screens at the same time.
 */
export function NotificationsBell({
  userId,
  initialNotifications,
  initialUnreadCount,
}: {
  userId: string;
  initialNotifications: NotificationRow[];
  /** True unread total from the server (the list only holds the latest 20 rows). */
  initialUnreadCount?: number;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const [unreadCount, setUnreadCount] = useState(
    initialUnreadCount ?? initialNotifications.filter((n) => !n.is_read).length
  );
  const notificationsRef = useRef(notifications);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // A server refresh (the fallback below, or any navigation) delivers fresh props: adopt them. Adjusting state
  // while rendering (rather than in an effect) is React's recommended way to resync state from changed props.
  const [seenProps, setSeenProps] = useState({ initialNotifications, initialUnreadCount });
  if (seenProps.initialNotifications !== initialNotifications || seenProps.initialUnreadCount !== initialUnreadCount) {
    setSeenProps({ initialNotifications, initialUnreadCount });
    setNotifications(initialNotifications);
    setUnreadCount(initialUnreadCount ?? initialNotifications.filter((n) => !n.is_read).length);
  }

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // Realtime can fail to deliver (dropped socket, overloaded database). Until the channel reports SUBSCRIBED,
    // fall back to refreshing the server-rendered list every minute and when the tab becomes visible again.
    let live = false;
    const refreshIfNotLive = () => {
      if (!live && document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refreshIfNotLive, 60_000);
    document.addEventListener("visibilitychange", refreshIfNotLive);
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          const inserted = payload.new as NotificationRow;
          if (!inserted.is_read) setUnreadCount((c) => c + 1);
          setNotifications((prev) => [inserted, ...prev].slice(0, 20));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as NotificationRow;
          const before = notificationsRef.current.find((n) => n.id === updated.id);
          if (before) {
            if (!before.is_read && updated.is_read) setUnreadCount((c) => Math.max(0, c - 1));
            else if (before.is_read && !updated.is_read) setUnreadCount((c) => c + 1);
          }
          setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        }
      )
      .subscribe((status) => {
        live = status === "SUBSCRIBED";
      });

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfNotLive);
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleClick(n: NotificationRow) {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      await markNotificationReadAction(n.id);
    }
    setOpen(false);
    // Same-site paths only: a stored link such as "https://evil.example" or "//evil.example" is ignored.
    if (n.link && safeSitePath(n.link)) router.push(n.link);
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await markAllNotificationsReadAction();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted hover:bg-off-white hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path
            d="M10 2.5c-2.2 0-4 1.8-4 4v2.4c0 .5-.2 1-.5 1.4l-1 1.2c-.6.7-.1 1.8.8 1.8h9.4c.9 0 1.4-1.1.8-1.8l-1-1.2c-.3-.4-.5-.9-.5-1.4V6.5c0-2.2-1.8-4-4-4z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M8.2 15.5a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-xs font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-14 z-20 sm:absolute sm:inset-x-auto sm:end-0 sm:top-11 sm:w-96 rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-ink"><Tx>Notifications</Tx></span>
            {unreadCount > 0 && (
              <Button type="button" onClick={handleMarkAllRead} variant="link" size="sm">
                <Tx>Mark all read</Tx>
              </Button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="p-4 text-center text-sm text-muted"><Tx>Nothing yet — this fills up as parties act on your projects.</Tx></p>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={
                  "block w-full border-b border-border px-3 py-2.5 text-start text-sm last:border-0 hover:bg-off-white " +
                  (n.is_read ? "" : "bg-burgundy/5")
                }
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-burgundy" />}
                  <div className="min-w-0 flex-1">
                    <p className={"truncate " + (n.is_read ? "text-ink" : "font-semibold text-ink")}>{n.title}</p>
                    {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-muted">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2 text-center">
            <Link href="/inspect/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-burgundy hover:underline">
              <Tx>View all notifications</Tx>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
