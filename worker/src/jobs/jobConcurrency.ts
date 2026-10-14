// Pure scheduling policy for bounded job concurrency (audit M4). A multi-pass Data Book render can run
// ~20 minutes; it must not block single-page renders or emails. Rule: at most WORKER_CONCURRENCY jobs run
// at once, and at most ONE "heavy" job (Data Book, report packs, portfolio summary) among them.

export type JobClass = "heavy" | "light";

export const DEFAULT_WORKER_CONCURRENCY = 2;
export const MAX_WORKER_CONCURRENCY = 4;
/** Heavy jobs claimed while another heavy job runs wait locally (not in a slot); beyond this we stop claiming. */
export const MAX_PARKED_JOBS = 2;

export function jobClass(jobType: string, payload?: Record<string, unknown> | null): JobClass {
  if (jobType === "render_data_book_pdf") return payload && payload.variant === "handover_certificate" ? "light" : "heavy";
  if (jobType === "generate_monthly_report_pack" || jobType === "generate_weekly_report_pack" || jobType === "render_portfolio_summary_pdf") {
    return "heavy";
  }
  return "light";
}

/** WORKER_CONCURRENCY: default 2, clamped to 1..4, garbage falls back to the default. */
export function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_WORKER_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WORKER_CONCURRENCY;
  return Math.min(MAX_WORKER_CONCURRENCY, Math.max(1, Math.floor(n)));
}

export interface SchedulerState {
  max: number;
  running: Map<string, JobClass>;
  parked: { id: string; cls: JobClass }[];
}

export function newSchedulerState(max: number): SchedulerState {
  return { max, running: new Map(), parked: [] };
}

function heavyRunning(s: SchedulerState): boolean {
  for (const c of s.running.values()) if (c === "heavy") return true;
  return false;
}

/** May the poll loop claim another job from the queue right now? */
export function canClaim(s: SchedulerState): boolean {
  return s.running.size < s.max && s.parked.length < MAX_PARKED_JOBS;
}

/** What to do with a freshly claimed job: run it now, or park it until the heavy slot frees. */
export function admit(s: SchedulerState, id: string, cls: JobClass): "start" | "park" {
  if (s.running.size >= s.max) return "park";
  if (cls === "heavy" && heavyRunning(s)) return "park";
  return "start";
}

export function markStarted(s: SchedulerState, id: string, cls: JobClass): void {
  s.parked = s.parked.filter((p) => p.id !== id);
  s.running.set(id, cls);
}

export function markParked(s: SchedulerState, id: string, cls: JobClass): void {
  s.parked.push({ id, cls });
}

export function markFinished(s: SchedulerState, id: string): void {
  s.running.delete(id);
}

/** Oldest parked job that may start now (a free slot, and the heavy slot if it needs it). */
export function nextParked(s: SchedulerState): { id: string; cls: JobClass } | null {
  if (s.running.size >= s.max) return null;
  return s.parked.find((p) => p.cls === "light" || !heavyRunning(s)) ?? null;
}
