// Strict, paginated loaders shared by the KPI computations and the KPI page. Everything here pages
// past PostgREST's 1000-row cap and THROWS on a query error, so a failed or truncated read can never
// show up as "0%" / "no data" (the old `data ?? []` pattern did exactly that).

import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, fetchAll, type PageResult } from "@/lib/supabase/fetch-all";

/** Runs a paginated query once per id chunk (keeps `.in()` URLs short) and concatenates the rows. */
export async function fetchAllInChunks<T, Id>(
  ids: Id[],
  build: (chunk: Id[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 100
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunkIds(ids, chunkSize)) {
    out.push(...(await fetchAll<T>((from, to) => build(chunk, from, to))));
  }
  return out;
}

export async function loadProjectItpIds(supabase: SupabaseClient, projectId: string): Promise<string[]> {
  const rows = await fetchAll<{ id: string }>((from, to) =>
    supabase.from("itps").select("id").eq("project_id", projectId).order("id").range(from, to)
  );
  return rows.map((r) => r.id);
}

export async function loadSectionsForItps(
  supabase: SupabaseClient,
  itpIds: string[]
): Promise<{ id: string; itp_id: string }[]> {
  return fetchAllInChunks<{ id: string; itp_id: string }, string>(itpIds, (chunk, from, to) =>
    supabase.from("itp_sections").select("id, itp_id").in("itp_id", chunk).order("id").range(from, to)
  );
}

/** Items for a set of sections; `columns` must include `id`. */
export async function loadItemsForSections<T extends { id: string }>(
  supabase: SupabaseClient,
  sectionIds: string[],
  columns: string
): Promise<T[]> {
  return fetchAllInChunks<T, string>(sectionIds, (chunk, from, to) =>
    supabase.from("itp_items").select(columns).in("section_id", chunk).order("id").range(from, to).returns<T[]>()
  );
}
