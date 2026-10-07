import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-job abort flag. index.ts runs each job inside `jobAbortStorage.run(ctx, ...)` and sets
 * `ctx.aborted = true` when the wall-clock timeout fires. `Promise.race` cannot cancel the losing
 * job, so renderers and the vault filer call `assertNotAborted()` before any side effect (storage
 * upload, vault insert): a job already marked failed/retried must not publish a document afterwards.
 */
export interface JobAbortContext {
  aborted: boolean;
}

export const jobAbortStorage = new AsyncLocalStorage<JobAbortContext>();

export class JobAbortedError extends Error {
  constructor() {
    super("Job was aborted after timing out; skipping side effects.");
    this.name = "JobAbortedError";
  }
}

export function assertNotAborted(): void {
  if (jobAbortStorage.getStore()?.aborted) throw new JobAbortedError();
}

/** Errors that will fail identically on retry (validation / precondition failures). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
