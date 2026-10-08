// Plain (non-"use server") helpers to read a project's IANA timezone (projects.timezone, migration
// 20261104000500). Reads tolerate the column not existing yet: callers then get no zone and fall
// back to the environment site zone (lib/ncrs/site-date.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { isValidTimeZone } from "@/lib/ncrs/site-date";

/** Normalises a typed zone: blank = not provided (null); otherwise it must be a valid IANA zone. */
export function parseProjectTimeZone(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: true, value: null };
  if (v.length > 64 || !isValidTimeZone(v)) {
    return { ok: false, error: "Time zone must be a valid IANA zone such as Asia/Dubai, Europe/London or UTC." };
  }
  return { ok: true, value: v };
}

/** projects.timezone for each id (only valid zones; unknown ids are absent from the map). */
export async function fetchProjectTimeZones(supabase: SupabaseClient, projectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(projectIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, timezone" as never)
      .in("id", ids.slice(i, i + 150))
      .returns<{ id: string; timezone: string | null }[]>();
    if (error) {
      if (isMissingSchemaError(error)) return out;
      continue;
    }
    for (const r of data ?? []) if (isValidTimeZone(r.timezone)) out.set(r.id, r.timezone);
  }
  return out;
}

export async function fetchProjectTimeZone(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  return (await fetchProjectTimeZones(supabase, [projectId])).get(projectId) ?? null;
}
