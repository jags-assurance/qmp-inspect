/**
 * Coalesces bursts of Supabase realtime events into few `router.refresh()` calls (D-04).
 *
 * Every postgres_changes event used to trigger a full server re-render, so a bulk import, 50
 * checklist answers or a sign-off cascade caused 50 refreshes. This scheduler:
 *  - waits `debounceMs` after the LAST event (trailing debounce), so a burst is one refresh;
 *  - but never waits longer than `maxWaitMs` from the FIRST pending event, so a continuous stream
 *    (a live import) still refreshes periodically instead of starving the screen forever;
 *  - does nothing while the tab is hidden, and runs one refresh when it becomes visible again.
 *
 * Framework-free (timers and visibility are injected) so it is unit-testable.
 */
export interface RefreshSchedulerOptions {
  refresh: () => void;
  isVisible: () => boolean;
  debounceMs?: number;
  maxWaitMs?: number;
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

export function createRefreshScheduler(options: RefreshSchedulerOptions): RefreshScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_REFRESH_DEBOUNCE_MS;
  const maxWaitMs = Math.max(debounceMs, options.maxWaitMs ?? DEFAULT_REFRESH_MAX_WAIT_MS);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let firstPendingAt: number | null = null;
  let pendingWhileHidden = false;
  let disposed = false;

  const fire = () => {
    timer = null;
    firstPendingAt = null;
    if (disposed) return;
    if (!options.isVisible()) {
      pendingWhileHidden = true;
      return;
    }
    options.refresh();
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
      timer = setTimer(fire, Math.min(debounceMs, remainingBudget));
    },
    visibilityChanged() {
      if (disposed || !options.isVisible() || !pendingWhileHidden) return;
      pendingWhileHidden = false;
      options.refresh();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
