import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { AUDIT_LOG_TABLE } from "@/lib/audit/types";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  AUDIT_EXPORT_PAGE_SIZE,
  auditCsvHeaderLine,
  auditCsvLine,
  auditExportFilename,
  auditRowToCsvCells,
  describeAuditFilters,
  iterateAuditPages,
  parseAuditExportFilters,
  type AuditExportRow,
} from "@/lib/audit/export";

const COLS = "id, entity_type, entity_id, action, summary, changes, created_at, actor_id, actor:users(full_name, email)";

/**
 * CSV export of a project's audit log, honouring the page's ?range=&cat=&actor= filters. Same permission
 * as viewing the log (JAGS staff; RLS still scopes the rows to what they can read). Every matching row
 * is exported - it pages through the table 1000 at a time and streams the file, so there is no row cap.
 * The export itself is written to the audit log before any data is sent.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ projectId: string }> }) {
  const session = await getSessionContext();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!session.isJagsStaff) return new NextResponse("The audit log is only available to JAGS staff.", { status: 403 });

  const { projectId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const filters = parseAuditExportFilters({ range: sp.get("range"), cat: sp.get("cat"), actor: sp.get("actor") });

  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ id: string; project_number: string; name: string; organization_id: string }>();
  if (!project) return new NextResponse("Project not found.", { status: 404 });

  const fetchPage = async (from: number, to: number): Promise<AuditExportRow[]> => {
    let query = supabase
      .from(AUDIT_LOG_TABLE)
      .select(COLS)
      .eq("project_id", projectId)
      // id as a tiebreak keeps pages stable when many events share a timestamp.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (filters.fromIso) query = query.gte("created_at", filters.fromIso);
    if (filters.cat) query = query.eq("entity_type", filters.cat);
    if (filters.actor) query = query.eq("actor_id", filters.actor);
    const { data, error } = await query.returns<AuditExportRow[]>();
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  // Fail before streaming if the very first page cannot be read, so the client gets a real error status.
  let first: AuditExportRow[];
  try {
    first = await fetchPage(0, AUDIT_EXPORT_PAGE_SIZE - 1);
  } catch {
    return new NextResponse("Could not build the export.", { status: 500 });
  }

  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "project",
    entityId: projectId,
    action: "audit_log_exported",
    actorId: session.userId,
    summary: `Audit log exported as CSV (${describeAuditFilters(filters)})`,
    changes: { format: "csv", filters },
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("﻿" + auditCsvHeaderLine()));
        // The first page is already in hand; later pages are fetched lazily as the stream is consumed.
        let firstDone = false;
        const pages = iterateAuditPages(async (from, to) => {
          if (!firstDone && from === 0) {
            firstDone = true;
            return first;
          }
          return fetchPage(from, to);
        });
        for await (const rows of pages) {
          controller.enqueue(encoder.encode(rows.map((r) => auditCsvLine(auditRowToCsvCells(r))).join("")));
        }
        controller.close();
      } catch (err) {
        console.error("[audit-export] failed mid-stream", err);
        // Never leave a silently short file: mark the truncation inside the CSV, then error the stream.
        controller.enqueue(encoder.encode(auditCsvLine(["EXPORT INCOMPLETE: a read failed part-way through - do not rely on this file."])));
        controller.error(err);
      }
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${auditExportFilename(project.project_number, "csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}
