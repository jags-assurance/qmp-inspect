import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error" | "skipped";
interface CheckResult {
  status: CheckStatus;
  /** Round-trip time of the check in milliseconds. */
  ms: number;
}

/** A hung dependency must fail the check, not hang the monitor. */
const CHECK_TIMEOUT_MS = 5_000;

/**
 * Runs one dependency probe with a timeout and records its latency. `probe` resolves to an error
 * (or null for success); anything thrown or timing out counts as "error". Failure detail goes to
 * the server log only, never into the response.
 */
async function timed(
  name: string,
  probe: () => PromiseLike<{ error: { message: string } | null }>,
  onError: Exclude<CheckStatus, "ok"> = "error"
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const result = await Promise.race([
      Promise.resolve(probe()),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), CHECK_TIMEOUT_MS)),
    ]);
    if (result.error) {
      console.error(`[health] ${name} check failed: ${result.error.message}`);
      return { status: onError, ms: Date.now() - started };
    }
    return { status: "ok", ms: Date.now() - started };
  } catch (err) {
    console.error(`[health] ${name} check threw:`, err instanceof Error ? err.message : err);
    return { status: "error", ms: Date.now() - started };
  }
}

/**
 * Liveness/readiness check for uptime monitors, load balancers, and on-call engineers.
 * Deliberately unauthenticated (see PUBLIC_PATHS in proxy.ts) — a monitor has no session cookie.
 *
 * Does real work rather than returning a hardcoded "ok". With the service role configured it:
 *  - counts a real table (an anonymous query returns zero rows under RLS even when the data layer
 *    is broken, so it could never fail),
 *  - checks that the schema the app depends on is present (a table from the latest security
 *    migrations; "skipped" until those are applied, since the app falls back without them),
 *  - checks that Storage answers,
 *  - and reports worker liveness (a pending background job older than 15 minutes means the poll
 *    loop is stalled).
 * Without the service role it falls back to the anonymous round trip. Every probe has a timeout and
 * reports its latency. The response contains only statuses, latencies, a short build id and a
 * timestamp: no error text, hostnames, keys or configuration values.
 */
export async function GET() {
  const checks: Record<string, CheckResult> = {};
  try {
    if (isServiceRoleConfigured()) {
      const service = createSupabaseServiceRoleClient();
      const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      const [database, schema, storage] = await Promise.all([
        timed("database", () => service.from("organizations").select("id", { count: "exact", head: true })),
        timed("schema", () => service.from("auth_attempts" as never).select("id", { head: true, count: "exact" }), "skipped"),
        timed("storage", () => service.storage.from("inspection-evidence").list("", { limit: 1 })),
      ]);
      checks.database = database;
      checks.schema = schema;
      checks.storage = storage;

      // Worker: pending jobs older than 15 minutes. A missing table (older schema) is "skipped".
      const started = Date.now();
      try {
        const { count, error } = await service
          .from("background_jobs" as never)
          .select("id", { count: "exact", head: true })
          .eq("status" as never, "pending" as never)
          .lt("created_at" as never, cutoff as never);
        if (error) {
          checks.worker = { status: "skipped", ms: Date.now() - started };
        } else {
          checks.worker = { status: (count ?? 0) > 0 ? "error" : "ok", ms: Date.now() - started };
          if ((count ?? 0) > 0) console.error(`[health] ${count} background job(s) pending for over 15 minutes`);
        }
      } catch (err) {
        console.error("[health] worker check threw:", err instanceof Error ? err.message : err);
        checks.worker = { status: "skipped", ms: Date.now() - started };
      }
    } else {
      const supabase = await createSupabaseServerClient();
      checks.database = await timed("database", () => supabase.from("organizations").select("id").limit(1));
    }
  } catch (err) {
    console.error("[health] check threw:", err instanceof Error ? err.message : err);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }

  // A stalled worker degrades but does not take the web app out of rotation; a missing optional
  // schema probe is informational.
  const critical = checks.database?.status === "error" || checks.storage?.status === "error";
  const degraded = checks.worker?.status === "error";
  const build = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7);
  return NextResponse.json(
    {
      status: critical ? "error" : degraded ? "degraded" : "ok",
      // `checks` keeps its original shape (name -> status string); latencies are reported separately.
      checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.status])),
      latencyMs: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.ms])),
      ...(build ? { build } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: critical ? 503 : 200, headers: { "Cache-Control": "no-store" } }
  );
}
