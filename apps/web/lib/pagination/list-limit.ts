/**
 * "Load more" windowing for list pages whose client component filters/sorts the loaded rows (punch
 * list, registers, vault folder). A plain `.select()` on those used to return every row (and
 * PostgREST silently stops at 1000), so a big project shipped a huge RSC payload on every render.
 * Now the page reads `?limit=` (clamped), asks the database for `limit` rows, and shows a
 * "Load more" link that raises the limit by one step, up to a hard ceiling.
 *
 * Pure functions only, so they are unit tested without a request context.
 */

export interface ListLimitOptions {
  /** Rows shown on first load. */
  defaultLimit: number;
  /** Rows added by each "Load more". */
  step: number;
  /** Hard ceiling; past it the page tells the user to filter or export instead. */
  max: number;
}

export const DEFAULT_LIST_LIMITS: ListLimitOptions = { defaultLimit: 200, step: 200, max: 2000 };

/** Parses a `?limit=` value. Anything missing, non-numeric, or below the default falls back to the default; above max is clamped. */
export function parseListLimit(raw: string | string[] | undefined | null, options: ListLimitOptions = DEFAULT_LIST_LIMITS): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < options.defaultLimit) return options.defaultLimit;
  return Math.min(parsed, options.max);
}

/** The limit the "Load more" link should request, or null when the ceiling has been reached. */
export function nextListLimit(current: number, options: ListLimitOptions = DEFAULT_LIST_LIMITS): number | null {
  if (current >= options.max) return null;
  return Math.min(current + options.step, options.max);
}

export interface ListWindow {
  /** Rows actually shown. */
  shown: number;
  /** Exact total when known, otherwise null. */
  total: number | null;
  /** More rows exist beyond the ones shown. */
  hasMore: boolean;
  /** The limit to request next, or null when there is nothing more to load or the ceiling is reached. */
  next: number | null;
  /** More rows exist but the ceiling stops "Load more" (the user must filter or export). */
  atCeiling: boolean;
}

/**
 * Describes the window. Pass `total` when the query returned an exact count; otherwise the caller
 * over-fetches by one row (`limit + 1`) and passes `fetched` as that raw length so hasMore is exact.
 */
export function describeListWindow(params: {
  limit: number;
  fetched: number;
  total?: number | null;
  options?: ListLimitOptions;
}): ListWindow {
  const options = params.options ?? DEFAULT_LIST_LIMITS;
  const total = params.total ?? null;
  const shown = Math.min(params.fetched, params.limit);
  const hasMore = total !== null ? total > shown : params.fetched > params.limit;
  const next = hasMore ? nextListLimit(params.limit, options) : null;
  return { shown, total, hasMore, next, atCeiling: hasMore && next === null };
}

/**
 * Merges two row sets (e.g. "newest N" and "everything still awaiting review") into one list,
 * de-duplicated by id and ordered newest first by `created_at`.
 */
export function mergeNewestFirst<T extends { id: string; created_at: string }>(primary: T[], extra: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of [...primary, ...extra]) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Builds `<path>?<existing params>&limit=<n>` (an existing `limit` is replaced; array values are kept). */
export function hrefWithLimit(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
  limit: number
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "limit" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  qs.set("limit", String(limit));
  return `${path}?${qs.toString()}`;
}
