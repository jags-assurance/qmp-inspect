/**
 * Coalesces bursts of Supabase realtime events into few `router.refresh()` calls (D-04).
 *
 * Every postgres_changes event used to trigger a full server re-render, so a bulk import, 50
 * checklist answers or a sign-off cascade caused 50 refreshes. This scheduler:
 *  - waits `debounceMs` after the LAST event (trailing debounce), so a burst is one refresh;
 *  - but never waits longer than `maxWaitMs` from the FIRST pending event, so a continuous stream
 *    (a live import) still refreshes periodically instead of starving the screen forever;
 *  - does nothing while the tab is hidden, and runs one refresh when it becomes visible again;
 *  - never starts a refresh within `minIntervalMs` of the previous one (a hard rate limit: each
 *    refresh re-runs the layout and the page's queries, so a chatty table must not do that every
 *    few seconds);
 *  - never starts a refresh while the previous one is still in flight (`isBusy`): when the database
 *    is slow a refresh takes many seconds, and stacking more on top of it only makes it slower. The
 *    pending event is kept and retried after the debounce, not dropped.
 *
 * Framework-free (timers and visibility are injected) so it is unit-testable.
 */
export interface RefreshSchedulerOptions {
  refresh: () => void;
  isVisible: () => boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Minimum gap between two refreshes (default 0 here; the component passes DEFAULT_REFRESH_MIN_INTERVAL_MS). */
  minIntervalMs?: number;
  /** True while the previous refresh has not finished rendering. */
  isBusy?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface RefreshScheduler {
  /** Call for every realtime event. */
  notify(): void;
  /** Call when the tab's visibility changes. */
  visibilityChanged(): void;
  /** Cancel any pending refresh (unmount). */
  dispose(): void;
}

export const DEFAULT_REFRESH_DEBOUNCE_MS = 1500;
export const DEFAULT_REFRESH_MAX_WAIT_MS = 6000;
export const DEFAULT_REFRESH_MIN_INTERVAL_MS = 5000;

export function createRefreshScheduler(options: RefreshSchedulerOptions): RefreshScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_REFRESH_DEBOUNCE_MS;
  const maxWaitMs = Math.max(debounceMs, options.maxWaitMs ?? DEFAULT_REFRESH_MAX_WAIT_MS);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
  const isBusy = options.isBusy ?? (() => false);

  let timer: unknown = null;
  let lastRefreshAt: number | null = null;
  let firstPendingAt: number | null = null;
  let pendingWhileHidden = false;
  let disposed = false;

  const runRefresh = () => {
    lastRefreshAt = now();
    options.refresh();
  };

  const fire = () => {
    timer = null;
    if (disposed) return;
    if (!options.isVisible()) {
      firstPendingAt = null;
      pendingWhileHidden = true;
      return;
    }
    if (isBusy()) {
      // The previous refresh is still rendering: keep the pending event and look again shortly.
      timer = setTimer(fire, debounceMs);
      return;
    }
    firstPendingAt = null;
    runRefresh();
  };

  return {
    notify() {
      if (disposed) return;
      if (!options.isVisible()) {
        pendingWhileHidden = true;
        return;
      }
      const t = now();
      if (firstPendingAt === null) firstPendingAt = t;
      if (timer !== null) clearTimer(timer);
      // Trailing debounce, capped so the oldest pending event is never delayed past maxWaitMs.
      const remainingBudget = Math.max(0, firstPendingAt + maxWaitMs - t);
      const sinceLast = lastRefreshAt === null ? Infinity : t - lastRefreshAt;
      const rateLimitWait = Math.max(0, minIntervalMs - sinceLast);
      timer = setTimer(fire, Math.max(Math.min(debounceMs, remainingBudget), rateLimitWait));
    },
    visibilityChanged() {
      if (disposed || !options.isVisible() || !pendingWhileHidden) return;
      pendingWhileHidden = false;
      runRefresh();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
