import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { constantTimeEqual } from "@/lib/vault/email-inbound-security";
import { runSignoffAutomationSweep } from "@/lib/signoff/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled catch-up for the phase-2 sign-off automation (see lib/signoff/automation.ts), called by
 * Vercel Cron (apps/web/vercel.json). It is the only way the time-based part (a Witness/Surveillance
 * notice period running out with no response) can happen without anyone clicking. Does nothing for an
 * organisation unless that organisation switched the automation on, and never touches a Hold or Review.
 *
 * Authenticated by CRON_SECRET (Vercel sends it as `Authorization: Bearer <CRON_SECRET>`); with no
 * secret configured the route refuses every call. No session, so /api/cron/signoff-automation is on the
 * signed-out allow list in lib/auth/public-paths.ts.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  try {
    const supabase = createSupabaseServiceRoleClient();
    const result = await runSignoffAutomationSweep(supabase as never);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] signoff-automation failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
