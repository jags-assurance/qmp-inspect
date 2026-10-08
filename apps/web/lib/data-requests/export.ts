// U6: the per-user data export (docs/DATA_SUBJECT_REQUESTS.md). Pure helpers: the caller supplies a
// Supabase client and gets back JSON text chunks, so the route handler can stream the file and the tests
// can run the same code against the mock harness.
//
// Scope: everything the system holds ABOUT one user that is keyed to their account id. It deliberately
// excludes secrets and bulky content that is not "about" the person: no password or token material (none
// is stored in public tables), no signature images (data URLs), no AI prompt/response text, no other
// people's email addresses (for example transmittal recipients).

export interface ExportTarget {
  id: string;
  email: string;
  full_name: string;
}

/** The slice of the Supabase client the export needs (kept loose so the mock harness fits). */
export interface ExportDb {
  from(table: string): unknown;
}

interface QueryPage {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}
type PageQuery = {
  select(columns: string): PageQuery;
  eq(column: string, value: string): PageQuery;
  order(column: string, opts?: { ascending: boolean }): PageQuery;
  range(from: number, to: number): PromiseLike<QueryPage>;
};

export interface SectionDef {
  /** Key in the output file. */
  key: string;
  table: string;
  /** The column that holds this user's id. */
  column: string;
  /** Explicit column list: never "*", so a secret added to a table later does not leak into exports. */
  columns: string;
  /** Unique, stable sort for paging (defaults to "id"). */
  order?: string;
  /** What the section is, written into the file so a reader without the schema can follow it. */
  describes: string;
}

export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_VERSION = 1;

export const PROFILE_COLUMNS = "id, email, full_name, is_jags_staff, staff_role, is_active, terms_accepted_at, terms_version, created_at, updated_at";
/** Used when the terms-acceptance columns (20261128000100) are not in the database yet. */
export const PROFILE_COLUMNS_FALLBACK = "id, email, full_name, is_jags_staff, staff_role, is_active, created_at, updated_at";

export const EXPORT_SECTIONS: SectionDef[] = [
  { key: "access_grants", table: "access_grants", column: "user_id", columns: "id, scope_type, organization_id, project_id, role, created_at", describes: "Access grants held by the account" },
  { key: "custom_role_assignments", table: "custom_role_assignments", column: "user_id", columns: "id, role_id, project_id, created_at", describes: "Custom roles assigned to the account" },
  { key: "team_memberships", table: "team_members", column: "user_id", columns: "team_id, user_id, is_team_lead, created_at", order: "team_id", describes: "JAGS team memberships" },
  { key: "client_team_memberships", table: "client_team_members", column: "user_id", columns: "client_team_id, user_id, is_team_lead, created_at", order: "client_team_id", describes: "Client team memberships" },
  { key: "party_memberships", table: "project_party_members", column: "user_id", columns: "id, project_party_id, invited_email, permission_mode, custom_role_id, granted_by, created_at", describes: "Project party memberships" },
  { key: "audit_events_performed", table: "audit_log", column: "actor_id", columns: "id, organization_id, project_id, entity_type, entity_id, action, summary, changes, created_at", describes: "Audit log events the account performed" },
  { key: "notifications_received", table: "notifications", column: "recipient_user_id", columns: "id, organization_id, project_id, title, body, link, is_read, created_at", describes: "In-app notifications sent to the account" },
  { key: "email_deliveries", table: "email_outbox", column: "recipient_user_id", columns: "id, notification_id, status, attempts, sent_at, created_at", describes: "Email delivery records for those notifications (status only, not the message body)" },
  { key: "inspections_signed", table: "inspection_records", column: "signed_by_user_id", columns: "id, project_id, record_number, overall_result, signed_by_name, signed_at, created_at", describes: "Inspection records the account signed (signature images are not included)" },
  { key: "inspections_performed", table: "inspection_records", column: "inspector_id", columns: "id, project_id, record_number, inspection_date, overall_result, created_at", describes: "Inspection records the account is the inspector on" },
  { key: "inspection_photos", table: "inspection_photos", column: "uploaded_by", columns: "id, inspection_record_id, storage_path, caption, created_at", describes: "Inspection photos the account uploaded (metadata, not the image files)" },
  { key: "ncr_photos", table: "ncr_photos", column: "uploaded_by", columns: "id, ncr_id, storage_path, caption, created_at", describes: "NCR photos the account uploaded (metadata, not the image files)" },
  { key: "standalone_assignment_photos", table: "standalone_assignment_photos", column: "uploaded_by", columns: "id, assignment_id, storage_path, caption, created_at", describes: "Standalone assignment photos the account uploaded (metadata, not the image files)" },
  { key: "vault_documents_uploaded", table: "vault_documents", column: "uploaded_by", columns: "id, folder_id, title, document_number, revision, status, created_at", describes: "Document Vault files the account uploaded (metadata, not the files)" },
  { key: "comments", table: "inspection_comments", column: "author_id", columns: "id, project_id, inspection_record_id, parent_id, body, created_at, edited_at, resolved_at", describes: "Inspection comments the account wrote" },
  { key: "document_transmittals_sent", table: "document_transmittals", column: "sent_by", columns: "id, entity_type, entity_label, subject, status, created_at", describes: "Document emails the account sent (recipient addresses are other people's data and are not included)" },
  { key: "ai_usage", table: "ai_usage_log", column: "user_id", columns: "id, organization_id, project_id, feature, model_id, input_tokens, output_tokens, decision, reviewed_at, created_at", describes: "AI feature usage rows (prompt and response text are not included)" },
];

export const EXPORT_NOTES = [
  "Records the person is named on remain in the system as quality records; this file lists the rows that point at their account.",
  "Names typed as free text inside shared records (for example captions, party member names written by someone else, report snapshots) are not matched by account and are not included.",
  "Storage files (photos, documents) are listed by path only; the files themselves are not part of this export.",
  "Audit events about the account (for example it being deactivated by an administrator) are recorded against the administrator and are not part of 'audit_events_performed'.",
];

export function exportFilename(userId: string, now: Date = new Date()): string {
  return `data-export-${userId}-${now.toISOString().slice(0, 10).replace(/-/g, "")}.json`;
}

const J = (v: unknown) => JSON.stringify(v);

async function readProfile(db: ExportDb, userId: string): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  for (const columns of [PROFILE_COLUMNS, PROFILE_COLUMNS_FALLBACK]) {
    const q = (db.from("users") as PageQuery).select(columns).eq("id", userId).range(0, 0);
    const { data, error } = await q;
    if (!error) return { row: data?.[0] ?? null, error: null };
    if (columns === PROFILE_COLUMNS_FALLBACK) return { row: null, error: error.message };
  }
  return { row: null, error: "unreadable" };
}

/**
 * The export as JSON text chunks (concatenate them to get one valid JSON document). Sections are read a
 * page at a time and emitted as they arrive, so a large audit trail never has to sit in memory. A section
 * that cannot be read is recorded under "unavailable_sections" and "complete" is false: an export is never
 * silently short.
 */
export async function* exportChunks(
  db: ExportDb,
  target: ExportTarget,
  meta: { generatedAt: Date; generatedBy: string; readWith: "service_role" | "user_session" }
): AsyncGenerator<string> {
  const profile = await readProfile(db, target.id);
  const unavailable: { section: string; error: string }[] = [];
  const counts: Record<string, number> = {};

  yield `{"export_version":${EXPORT_VERSION},"generated_at":${J(meta.generatedAt.toISOString())},"generated_by_user_id":${J(meta.generatedBy)},"read_with":${J(meta.readWith)},"subject_user_id":${J(target.id)},"notes":${J(EXPORT_NOTES)},"profile":`;
  if (profile.error) unavailable.push({ section: "profile", error: profile.error });
  yield J(profile.row);
  counts.profile = profile.row ? 1 : 0;

  yield `,"sections":{`;
  let firstSection = true;
  for (const section of EXPORT_SECTIONS) {
    yield `${firstSection ? "" : ","}${J(section.key)}:{"describes":${J(section.describes)},"rows":[`;
    firstSection = false;
    let count = 0;
    let first = true;
    for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
      const q = (db.from(section.table) as PageQuery)
        .select(section.columns)
        .eq(section.column, target.id)
        .order(section.order ?? "id", { ascending: true })
        .range(from, from + EXPORT_PAGE_SIZE - 1);
      const { data, error } = await q;
      if (error) {
        unavailable.push({ section: section.key, error: error.message });
        break;
      }
      const rows = data ?? [];
      if (rows.length) {
        yield `${first ? "" : ","}${rows.map(J).join(",")}`;
        first = false;
        count += rows.length;
      }
      if (rows.length < EXPORT_PAGE_SIZE) break;
    }
    counts[section.key] = count;
    yield `]}`;
  }

  yield `},"row_counts":${J(counts)},"unavailable_sections":${J(unavailable)},"complete":${unavailable.length === 0}}`;
}

/** The whole export as one string (tests and small exports). */
export async function buildExportText(...args: Parameters<typeof exportChunks>): Promise<string> {
  let out = "";
  for await (const chunk of exportChunks(...args)) out += chunk;
  return out;
}
