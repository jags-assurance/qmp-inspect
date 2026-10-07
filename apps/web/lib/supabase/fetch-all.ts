/**
 * Hosted PostgREST caps every response at 1000 rows (max_rows) and a plain `.select()` just stops
 * there without an error, so any list or aggregate built from one query silently under-counts on a
 * big project. `fetchAll` pages with `.range()` until a short page comes back, and THROWS on a query
 * error instead of treating it as "no rows" (an empty result must never read as 100% complete).
 *
 *   const rows = await fetchAll<Row>((from, to) =>
 *     supabase.from("punch_list_items").select("id, status").eq("project_id", id).order("id").range(from, to)
 *   );
 *
 * Always order by a unique column so pages don't overlap. `max` is a safety stop, not a silent cap:
 * exceeding it throws.
 */
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; max?: number } = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  const max = options.max ?? 200_000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`Query failed: ${error.message}`);
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) return out;
    if (out.length >= max) throw new Error(`Query returned more than ${max} rows; refine the filter or aggregate in SQL.`);
  }
}

/** Splits a big id list into URL-safe chunks (a long `.in(...)` list can exceed gateway URL limits). */
export function chunkIds<T>(ids: T[], size = 150): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/** `.in()` over many ids: runs one query per chunk and concatenates, throwing on any error. */
export async function fetchInChunksStrict<T, Id>(
  ids: Id[],
  run: (chunk: Id[]) => PromiseLike<PageResult<T>>,
  size = 150
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunkIds(ids, size)) {
    const { data, error } = await run(chunk);
    if (error) throw new Error(`Query failed: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}
