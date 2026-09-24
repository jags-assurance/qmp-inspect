// Table-name handle + row shape for the `audit_log` table (supabase/migrations/20260922030000_audit_log.sql).
//
// `audit_log` isn't in the generated Database type yet, so `.from()` can't resolve it against the
// Tables map. Casting the table name here is the one place that gap leaks in; every query still
// gets its real row shape back via an explicit `.returns<T>()` / typed `.single<T>()`, so nothing
// downstream of this file works with untyped data. Same pattern as NCRS_TABLE in lib/ncrs/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AUDIT_LOG_TABLE = "audit_log" as any;

export interface AuditLogRow {
  id: string;
  // Nullable: a genuinely platform-wide event (e.g. granting/revoking GLOBAL-scope staff access)
  // isn't scoped to any one organisation — see 20260930030000_audit_log_platform_wide_events.sql.
  organization_id: string | null;
  project_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  summary: string;
  changes: Record<string, unknown> | null;
  created_at: string;
}
