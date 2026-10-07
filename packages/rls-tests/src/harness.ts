/**
 * Shared plumbing for the guard suites in this package (see guards.test.ts). The original
 * tenant-isolation suite keeps its own copy of this so it stays a single readable file; new suites
 * import from here.
 *
 * Nothing in this module talks to Supabase at import time, so the package type-checks (and the
 * files can be imported) with no environment configured. Only `readEnv()` looks at process.env.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// Reuse apps/web's own .env.local rather than requiring a separate copy of the same three secrets.
loadEnv({ path: path.resolve(__dirname, "../../../apps/web/.env.local") });

export interface RlsEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/** The three Supabase values every suite needs, or null when any is missing. */
export function readEnv(): RlsEnv | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

export const MISSING_ENV_MESSAGE =
  "[rls-tests] Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (or their NEXT_PUBLIC_ equivalents) in the environment.";

/** Unique per run; every fixture name embeds it so leftovers are greppable and never collide. */
export const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const MARK = `__rls_guard_${RUN_ID}__`;

const NO_SESSION = { auth: { autoRefreshToken: false, persistSession: false } } as const;

export function serviceClient(env: RlsEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, NO_SESSION);
}

/** A client signed in as `email` with the anon key, i.e. exactly what a browser session can do. */
export async function signedInClient(env: RlsEnv, email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(env.url, env.anonKey, NO_SESSION);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in as ${email} failed: ${error.message}`);
  return client;
}

/** Collects pass/fail results so one failed check does not hide the ones after it. */
export class Checks {
  readonly failures: { check: string; detail: string }[] = [];
  private count = 0;

  check(name: string, condition: boolean, detail: string): void {
    this.count += 1;
    if (condition) {
      console.log(`  ok   ${name}`);
    } else {
      console.error(`  FAIL ${name} — ${detail}`);
      this.failures.push({ check: name, detail });
    }
  }

  section(title: string): void {
    console.log(`\n[rls-tests] ${title}`);
  }

  get total(): number {
    return this.count;
  }
}

/** LIFO teardown stack: register a cleanup right after creating each thing, run it in `finally`. */
export class Teardown {
  private readonly steps: { label: string; run: () => PromiseLike<unknown> }[] = [];

  add(label: string, run: () => PromiseLike<unknown>): void {
    this.steps.push({ label, run });
  }

  async runAll(): Promise<void> {
    for (const step of this.steps.reverse()) {
      try {
        await step.run();
      } catch (error) {
        console.error(`[rls-tests] cleanup step "${step.label}" failed:`, error);
      }
    }
  }
}

/** Throws a readable error when a fixture write fails (a setup problem, not a security finding). */
export function must<T>(label: string, result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`fixture "${label}": ${result.error?.message ?? "no data returned"}`);
  }
  return result.data as NonNullable<T>;
}
