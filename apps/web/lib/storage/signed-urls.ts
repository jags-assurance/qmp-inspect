import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Batches signed-URL generation for many Storage objects in the same bucket into ONE Storage API
 * call (Supabase's `createSignedUrls`, plural) instead of one call per object. Fixes a real,
 * confirmed N+1: a photo-heavy page (e.g. an inspection record with 20 evidence photos) previously
 * fired 20 independent `createSignedUrl` round trips, one per `<PhotoThumbnail>` instance, each from
 * its own client-side `useEffect` (found in a 2026-09-23 performance audit). Callers now resolve the
 * whole set server-side in one call and pass each photo its own `url` prop — no client-side Storage
 * fetch left anywhere in the photo-thumbnail path.
 *
 * Returns a Map keyed by storage_path so callers can look up by path in O(1), matching whatever
 * shape their own photo list already has. A path that fails to sign (deleted object, bad path) is
 * simply absent from the map — never throws, since a missing thumbnail is far better than a failed
 * page render over one bad photo row.
 */
export async function getSignedPhotoUrls(
  supabase: SupabaseClient,
  bucket: string,
  storagePaths: string[],
  expiresInSeconds = 3600
): Promise<Map<string, string>> {
  const uniquePaths = [...new Set(storagePaths)];
  if (uniquePaths.length === 0) return new Map();

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(uniquePaths, expiresInSeconds);
  if (error || !data) return new Map();

  const map = new Map<string, string>();
  for (const row of data) {
    if (row.signedUrl && !row.error && row.path) map.set(row.path, row.signedUrl);
  }
  return map;
}
