/**
 * Opt-in gate for suites that WRITE to a real Supabase project.
 *
 * This repository has no staging database: the only Supabase project is the real one. The older suites
 * (tenant-isolation, guards) are gated only by the presence of credentials, which is why they are never
 * wired into the default `pnpm test`. New write suites additionally need two explicit flags, so a stray
 * `.env.local` on a laptop or a CI runner can never start them by accident:
 *
 *   RLS_ALLOW_WRITES=1                     I understand this suite creates and then deletes disposable rows.
 *   RLS_CONFIRM_SUPABASE_URL=<the url>     Must equal SUPABASE_URL exactly: I know which project this is.
 *
 * Without RLS_ALLOW_WRITES=1 the suite prints why it skipped and exits 0 (a skip, not a failure).
 * With the flag set but the confirmation wrong or missing it refuses and exits 1.
 */
import { MISSING_ENV_MESSAGE, readEnv, type RlsEnv } from "./harness";

export type GateResult = { run: true; env: RlsEnv } | { run: false; exitCode: 0 | 1; message: string };

export function liveWriteGate(suite: string, source: NodeJS.ProcessEnv = process.env): GateResult {
  if (source.RLS_ALLOW_WRITES !== "1") {
    return {
      run: false,
      exitCode: 0,
      message: `[rls-tests] ${suite} SKIPPED: it writes disposable fixtures to a real Supabase project. Set RLS_ALLOW_WRITES=1 and RLS_CONFIRM_SUPABASE_URL=<SUPABASE_URL> to run it.`,
    };
  }
  const env = readEnv();
  if (!env) return { run: false, exitCode: 1, message: MISSING_ENV_MESSAGE };
  if ((source.RLS_CONFIRM_SUPABASE_URL ?? "").trim() !== env.url.trim()) {
    return {
      run: false,
      exitCode: 1,
      message: `[rls-tests] ${suite} REFUSED: RLS_CONFIRM_SUPABASE_URL must equal the SUPABASE_URL it would write to (${env.url}).`,
    };
  }
  return { run: true, env };
}
