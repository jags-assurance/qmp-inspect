/**
 * A tiny in-process TTL memo with in-flight de-duplication (S7-25). Used to absorb repeated
 * Data Book readiness computations: the calculation pages through every ITP, inspection record,
 * NCR and register row of a project, and it was re-run on every render — including each
 * router.refresh() a realtime burst triggers and every switch back to the Data Book / KPI tab.
 *
 * - Concurrent callers for one key share a single computation (the promise is stored, not the value).
 * - A settled value is reused for `ttlMs`; a rejected computation is never remembered.
 * - Bounded (`maxEntries`, oldest evicted first) so a long-lived server process cannot grow without limit.
 *
 * Per process: on serverless each instance has its own memo, which only ever makes it less effective,
 * never wrong. The clock is injectable for tests.
 */
export class TtlMemo<V> {
  private readonly entries = new Map<string, { promise: Promise<V>; expiresAt: number | null }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
    private readonly now: () => number = () => Date.now()
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && (hit.expiresAt === null || hit.expiresAt > this.now())) return hit.promise;
    if (hit) this.entries.delete(key);

    const entry: { promise: Promise<V>; expiresAt: number | null } = { promise: load(), expiresAt: null };
    this.entries.set(key, entry);
    this.evictOverflow();
    entry.promise.then(
      () => {
        // Count the TTL from when the value is ready, not from when the load started.
        if (this.entries.get(key) === entry) entry.expiresAt = this.now() + this.ttlMs;
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
    );
    return entry.promise;
  }

  /** Drops every entry whose key starts with `prefix` (all of them when omitted). */
  invalidate(prefix = ""): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
