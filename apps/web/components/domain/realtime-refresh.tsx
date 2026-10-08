"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createRefreshScheduler,
  DEFAULT_REFRESH_DEBOUNCE_MS,
  DEFAULT_REFRESH_MIN_INTERVAL_MS,
} from "@/lib/realtime/refresh-scheduler";

const BUSY_FAILSAFE_MS = 30_000;

export interface RealtimeSource {
  table: string;
  filter?: string;
}

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
 * refresh runs when it becomes visible again). Two further guards stop a refresh storm when the
 * database is slow: refreshes are at least DEFAULT_REFRESH_MIN_INTERVAL_MS apart, and a new one is
 * never started while the previous one is still rendering (tracked with a transition). Several tables
 * that should refresh the SAME screen go in `also`, sharing one scheduler and one channel, so a burst
 * across them is one refresh rather than one per component.
 */
export function RealtimeRefresh({
  table,
  filter,
  also,
  debounceMs = DEFAULT_REFRESH_DEBOUNCE_MS,
  minIntervalMs = DEFAULT_REFRESH_MIN_INTERVAL_MS,
}: {
  table: string;
  filter?: string;
  also?: RealtimeSource[];
  debounceMs?: number;
  minIntervalMs?: number;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  // Timestamp the in-flight refresh started (0 = idle). A stuck flag can never block refreshes for
  // more than BUSY_FAILSAFE_MS.
  const busySinceRef = useRef(0);
  useEffect(() => {
    if (!isRefreshing) busySinceRef.current = 0;
  }, [isRefreshing]);
  const sourcesKey = JSON.stringify([{ table, filter }, ...(also ?? [])]);

  useEffect(() => {
    const scheduler = createRefreshScheduler({
      refresh: () => {
        busySinceRef.current = Date.now();
        startTransition(() => router.refresh());
      },
      isVisible: () => document.visibilityState !== "hidden",
      isBusy: () => busySinceRef.current !== 0 && Date.now() - busySinceRef.current < BUSY_FAILSAFE_MS,
      debounceMs,
      minIntervalMs,
    });
    const onVisibility = () => scheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);

    const supabase = createSupabaseBrowserClient();
    const sources = JSON.parse(sourcesKey) as RealtimeSource[];
    let channelBuilder = supabase.channel(`realtime-refresh:${sources.map((s) => `${s.table}:${s.filter ?? "all"}`).join("|")}`);
    for (const source of sources) {
      channelBuilder = channelBuilder.on(
        "postgres_changes",
        { event: "*", schema: "public", table: source.table, ...(source.filter ? { filter: source.filter } : {}) },
        () => scheduler.notify()
      );
    }
    const channel = channelBuilder.subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      scheduler.dispose();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey, debounceMs, minIntervalMs]);

  return null;
}
