"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createRefreshScheduler, DEFAULT_REFRESH_DEBOUNCE_MS } from "@/lib/realtime/refresh-scheduler";

/**
 * Subscribes to Postgres changes on one table (optionally filtered) and calls router.refresh() when
 * anything changes — the mechanism that makes "another party signed off" or "a new checklist
 * response came in" show up live on this screen instead of only after a manual reload. Deliberately
 * coarse (a full RSC refresh, not a targeted state patch): this app's pages are server-rendered from
 * real queries already, so re-running that query on change is simpler and less bug-prone than
 * duplicating each page's data-shaping logic client-side just to patch one row in place.
 *
 * D-04: events are debounced (see lib/realtime/refresh-scheduler.ts). A burst — a bulk import, 50
 * checklist answers, a sign-off cascade — is one refresh instead of one per event, a continuous
 * stream still refreshes every few seconds, and nothing refreshes while the tab is hidden (one
 * refresh runs when it becomes visible again).
 */
export function RealtimeRefresh({
  table,
  filter,
  debounceMs = DEFAULT_REFRESH_DEBOUNCE_MS,
}: {
  table: string;
  filter?: string;
  debounceMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const scheduler = createRefreshScheduler({
      refresh: () => router.refresh(),
      isVisible: () => document.visibilityState !== "hidden",
      debounceMs,
    });
    const onVisibility = () => scheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`realtime-refresh:${table}:${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => scheduler.notify())
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      scheduler.dispose();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, debounceMs]);

  return null;
}
