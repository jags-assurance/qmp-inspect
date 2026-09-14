"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Subscribes to Postgres changes on one table (optionally filtered) and calls router.refresh() when
 * anything changes — the mechanism that makes "another party signed off" or "a new checklist
 * response came in" show up live on this screen instead of only after a manual reload. Deliberately
 * coarse (a full RSC refresh, not a targeted state patch): this app's pages are server-rendered from
 * real queries already, so re-running that query on change is simpler and less bug-prone than
 * duplicating each page's data-shaping logic client-side just to patch one row in place.
 */
export function RealtimeRefresh({ table, filter }: { table: string; filter?: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`realtime-refresh:${table}:${filter ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter]);

  return null;
}
