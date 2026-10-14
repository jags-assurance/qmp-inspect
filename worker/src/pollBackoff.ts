// Idle backoff for the job poll loop. Every poll of an empty queue is an API call that Supabase logs
// (log ingestion is capped on the free plan), so the worker slows down while nothing is queued and snaps
// back to the fast interval as soon as a job shows up. Sweeps run on wall-clock timers (dueEvery), so
// slowing the poll does not change how often reminders, retries and retention run.

export const FAST_POLL_MS = 3000;
export const MID_POLL_MS = 5000;
export const SLOW_POLL_MS = 10000;

/** Delay before the next poll, given how many polls in a row found no job (0 right after a job). */
export function nextPollDelayMs(consecutiveIdlePolls: number): number {
  if (consecutiveIdlePolls < 10) return FAST_POLL_MS;
  if (consecutiveIdlePolls < 30) return MID_POLL_MS;
  return SLOW_POLL_MS;
}

/** Wall-clock "is this task due" gate: true the first time, then at most once per everyMs. */
export function makeDueGate(now: () => number = Date.now) {
  const last = new Map<string, number>();
  return (name: string, everyMs: number): boolean => {
    const t = now();
    const prev = last.get(name);
    if (prev === undefined || t - prev >= everyMs) {
      last.set(name, t);
      return true;
    }
    return false;
  };
}
