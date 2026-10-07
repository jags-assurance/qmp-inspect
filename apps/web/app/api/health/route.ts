import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness check for uptime monitors, load balancers, and on-call engineers.
 * Deliberately unauthenticated (see PUBLIC_PATHS in proxy.ts) — a monitor has no session cookie.
 *
 * Does real work rather than returning a hardcoded "ok". With the service role configured it counts
 * a real table (an anonymous query would return zero rows under RLS even when the data layer is
 * broken, and so could never fail) and checks that Storage answers; without it, it falls back to the
 * anonymous round trip. Failure details are logged server-side and the public response stays generic.
 * Worker liveness is reported separately in `worker` when a heartbeat table row exists (best-effort).
 */
export async function GET() {
  const checks: Record<string, "ok" | "error" | "skipped"> = {};
  try {
    if (isServiceRoleConfigured()) {
      const service = createSupabaseServiceRoleClient();
      const [{ error: dbError }, { error: storageError }] = await Promise.all([
        service.from("organizations").select("id", { count: "exact", head: true }),
        service.storage.from("inspection-evidence").list("", { limit: 1 }),
      ]);
      checks.database = dbError ? "error" : "ok";
      checks.storage = storageError ? "error" : "ok";
      if (dbError) console.error(`[health] database check failed: ${dbError.message}`);
      if (storageError) console.error(`[health] storage check failed: ${storageError.message}`);

      // Worker: oldest pending background job older than 15 minutes means the poll loop is stalled.
      const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count, error: workerError } = await service
        .from("background_jobs" as never)
        .select("id", { count: "exact", head: true })
        .eq("status" as never, "pending" as never)
        .lt("created_at" as never, cutoff as never);
      checks.worker = workerError ? "skipped" : (count ?? 0) > 0 ? "error" : "ok";
      if (checks.worker === "error") console.error(`[health] ${count} background job(s) pending for over 15 minutes`);
    } else {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.from("organizations").select("id").limit(1);
      checks.database = error ? "error" : "ok";
      if (error) console.error(`[health] database check failed: ${error.message}`);
    }
  } catch (err) {
    console.error("[health] check threw:", err instanceof Error ? err.message : err);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }

  // A stalled worker degrades but does not take the web app out of rotation.
  const critical = checks.database === "error" || checks.storage === "error";
  return NextResponse.json(
    { status: critical ? "error" : checks.worker === "error" ? "degraded" : "ok", checks, timestamp: new Date().toISOString() },
    { status: critical ? 503 : 200 }
  );
}
