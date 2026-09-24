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
    await supabase.from(AUDIT_LOG_TABLE).insert({
      organization_id: params.organizationId ?? null,
      project_id: params.projectId ?? null,
      entity_type: params.entityType,
      entity_id: params.entityId,
      action: params.action,
      actor_id: params.actorId ?? null,
      summary: params.summary,
      changes: params.changes ?? null,
    });
  } catch {
    // Best-effort — see doc comment above. Never throws; never blocks the caller's own mutation.
  }
}
