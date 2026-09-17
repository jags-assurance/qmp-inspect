import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Minimal liveness/readiness check for uptime monitors, load balancers, and on-call engineers.
 * Deliberately unauthenticated (see PUBLIC_PATHS in proxy.ts) — a monitor has no session cookie.
 *
 * Does one cheap, real Supabase round-trip (not a hardcoded "ok") so this actually catches an
 * unreachable/misconfigured database, not just "the Next.js process is up." Uses the same
 * server client factory as every other server-side query in the app rather than a bespoke client.
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.from("organizations").select("id").limit(1);

    if (error) {
      return NextResponse.json({ status: "error", error: error.message }, { status: 503 });
    }

    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ status: "error", error: message }, { status: 503 });
  }
}
