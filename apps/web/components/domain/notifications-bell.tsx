"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/notifications/actions";
import type { NotificationRow } from "@/lib/notifications/types";

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
export function NotificationsBell({ userId, initialNotifications }: { userId: string; initialNotifications: NotificationRow[] }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as NotificationRow, ...prev].slice(0, 20));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          const updated = payload.new as NotificationRow;
          setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

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
      await markNotificationReadAction(n.id);
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
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
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-burgundy text-[9px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-20 w-80 rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={handleMarkAllRead} className="text-xs font-medium text-burgundy hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="p-4 text-center text-sm text-muted">Nothing yet — this fills up as parties act on your projects.</p>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={
                  "block w-full border-b border-border px-3 py-2.5 text-left text-sm last:border-0 hover:bg-off-white " +
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
        </div>
      )}
    </div>
  );
}
