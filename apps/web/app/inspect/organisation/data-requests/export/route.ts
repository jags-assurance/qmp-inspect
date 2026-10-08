import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { getSessionContext, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { rateLimitResponse } from "@/lib/api/rate-limit";
import { exportChunks, exportFilename, type ExportDb, type ExportTarget } from "@/lib/data-requests/export";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * U6: JSON export of everything the system holds about one user (docs/DATA_SUBJECT_REQUESTS.md).
 * JAGS Admin only. The export itself is written to the audit log before any data is sent (the record
 * names the subject by id, never by name or email), and the file is streamed section by section.
 * Reads use the service role when it is configured, because some tables (notifications, the email
 * outbox) are not readable by another user's session; the admin check above is then the permission
 * check. Without the service role it falls back to the admin's own session and says so in the file.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionContext();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!isAdminStaff(session)) return new NextResponse("Only a JAGS Admin can export a user's data.", { status: 403 });

  const limited = rateLimitResponse("export", session.userId);
  if (limited) return limited;

  const userId = (req.nextUrl.searchParams.get("user_id") ?? "").trim();
  if (!UUID.test(userId)) return new NextResponse("A valid user_id is required.", { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase
    .from("users")
    .select("id, email, full_name")
    .eq("id", userId)
    .maybeSingle<ExportTarget>();
  if (!target) return new NextResponse("No such account.", { status: 404 });

  const useServiceRole = isServiceRoleConfigured();
  const db = (useServiceRole ? createSupabaseServiceRoleClient() : supabase) as unknown as ExportDb;

  await recordAuditEvent(supabase, {
    organizationId: null,
    entityType: "user",
    entityId: target.id,
    action: "data_exported",
    actorId: session.userId,
    summary: `Personal data export downloaded for user ${target.id}`,
    changes: { format: "json", read_with: useServiceRole ? "service_role" : "user_session" },
  });

  const encoder = new TextEncoder();
  const chunks = exportChunks(db, target, {
    generatedAt: new Date(),
    generatedBy: session.userId,
    readWith: useServiceRole ? "service_role" : "user_session",
  });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        console.error("[data-export] failed mid-stream", err);
        // Never leave a silently short file: the stream errors, so the download fails visibly.
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(target.id)}"`,
      "Cache-Control": "no-store",
    },
  });
}
