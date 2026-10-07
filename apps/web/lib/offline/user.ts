"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

let cached: { id: string | null; at: number } | null = null;

/**
 * The signed-in user's id as the browser knows it (local session storage, no network round-trip),
 * or null when it cannot be determined. Used to stamp every queued outbox item with its owner so a
 * different person signing in on a shared tablet never replays someone else's queued work. Never
 * throws and never waits long: offline, getSession() reads the stored session and only tries the
 * network when a refresh is due.
 */
export async function getLocalUserId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (cached && Date.now() - cached.at < 30_000) return cached.id;
  try {
    const supabase = createSupabaseBrowserClient();
    const result = await Promise.race([
      supabase.auth.getSession().then((r) => r.data.session?.user?.id ?? null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    cached = { id: result, at: Date.now() };
    return result;
  } catch {
    return null;
  }
}
