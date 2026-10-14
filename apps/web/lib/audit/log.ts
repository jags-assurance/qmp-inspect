// Deliberately NOT "use server" — this is a plain server-only helper called directly from other
// server actions (lib/itps/actions.ts, lib/ncrs/actions.ts, lib/signoff/actions.ts,
// lib/checklists/actions.ts), never invoked as a Server Action in its own right from a client
// boundary. Mirrors lib/notifications/helpers.ts's createNotification in every respect: same
// "plain helper, best-effort, called after the real mutation already succeeded" shape.

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE } from "./types";

/**
 * Records one audit_log row — the centralized "who did what and when" trail R102 asks for, sitting
 * alongside (not replacing) the scattered per-row *_by/*_at columns and ai_usage_log that already
 * exist. Uses the SAME supabase client/request context as the calling action, so the insert runs
 * under that user's RLS (audit_log_insert only requires org access to the event's own
 * organization_id — see the migration — matching the pattern createNotification already uses).
 *
 * organizationId is nullable: omit it (or pass null) for a genuinely platform-wide event that isn't
 * scoped to any one organisation — e.g. granting/revoking a GLOBAL-scope access_grants row. RLS
 * (20260930030000_audit_log_platform_wide_events.sql) only lets JAGS staff read or write a null-org
 * row, since a platform-wide event is inherently a staff-only concern — never omit organizationId
 * for an event that genuinely does belong to one organisation just because it's convenient.
 *
 * Failures are logged (console.error, which Sentry captures once enabled) instead of swallowed, but never thrown.
 *
 * Best-effort: a failure here must never fail — or even surface an error on — the mutation it's
 * recording. The underlying business event (the ITP approval, the NCR close, the sign-off, ...) has
 * already happened and is the source of truth; this is a convenience trail on top, not part of the
 * transaction. Every call site should call this AFTER its real mutation has already succeeded,
 * wrapped in try/catch the same way createNotification's call sites already are, and never let it
 * block or fail the caller's own response.
 */
export async function recordAuditEvent(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    organizationId?: string | null;
    projectId?: string | null;
    entityType: string;
    entityId: string;
    action: string;
    actorId?: string | null;
    summary: string;
    changes?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    // Preferred path: record_audit_event() (20261104000300) is SECURITY DEFINER and forces
    // actor_id = auth.uid() and checks project/org access itself, so a caller can never attribute an
    // event to someone else. params.actorId is therefore informational only.
    const { error: rpcError } = await (supabase as unknown as RpcClient).rpc("record_audit_event", {
      p_organization_id: params.organizationId ?? null,
      p_project_id: params.projectId ?? null,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_action: params.action,
      p_summary: params.summary,
      p_changes: params.changes ?? null,
    });
    if (!rpcError) return;

    if (!RPC_MISSING_CODES.has(rpcError.code ?? "")) {
      // The function exists and refused (or the database errored): a real failure, never retried
      // through the direct-insert path (that would be the very forgery route the function closes).
      console.error(`[audit] record_audit_event failed (${params.entityType}/${params.action}): ${rpcError.message}`);
      return;
    }

    // Function not deployed yet (migration pending): fall back to the original direct insert.
    // A project-scoped event must carry its organisation (org-scoped views and RLS depend on it). The RPC
    // above derives it; this legacy path derives it the same way. Genuinely platform-wide events (auth,
    // staff grants: no project) keep organization_id NULL on purpose.
    const organizationId = await resolveAuditOrganizationId(supabase, params.organizationId ?? null, params.projectId ?? null);
    const { error } = await supabase.from(AUDIT_LOG_TABLE).insert({
      organization_id: organizationId,
      project_id: params.projectId ?? null,
      entity_type: params.entityType,
      entity_id: params.entityId,
      action: params.action,
      actor_id: params.actorId ?? null,
      summary: params.summary,
      changes: params.changes ?? null,
    });
    if (error) {
      console.error(`[audit] insert failed (${params.entityType}/${params.action}): ${error.message}`);
    }
  } catch (err) {
    console.error(`[audit] unexpected failure (${params.entityType}/${params.action}):`, err instanceof Error ? err.message : err);
  }
}

// Same "object not there yet" codes used across the app for graceful degradation before a migration
// is applied: undefined function, undefined column, undefined table, and PostgREST's schema-cache misses.
const RPC_MISSING_CODES = new Set(["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"]);

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { code?: string; message: string } | null }>;
}

/** The organisation an audit row belongs to: the explicit one, else the project's, else null (platform-wide). */
export async function resolveAuditOrganizationId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string | null,
  projectId: string | null
): Promise<string | null> {
  if (organizationId || !projectId) return organizationId;
  const { data } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  return (data as { organization_id: string | null } | null)?.organization_id ?? null;
}
