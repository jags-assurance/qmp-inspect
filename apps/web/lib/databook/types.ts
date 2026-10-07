// Domain types + table-name handles for the `data_books` / `handover_certificates` tables
// (supabase/migrations/20260910010000_phase1_punch_list_databook_handover.sql).
//
// The enums below mirror those tables' CHECK constraints, the same way packages/shared-types/src/
// domain.ts mirrors the others — they belong there once that file can be touched (see this
// module's final report).
//
// Neither table is in the generated Database type yet, so `.from()` can't resolve them against the
// Tables map. Casting the table name here is the one place that gap leaks in; every query still
// gets its real row shape back via an explicit `.returns<T>()` / typed `.single<T>()`, so nothing
// downstream of this file works with untyped data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const DATA_BOOKS_TABLE = "data_books" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const HANDOVER_CERTIFICATES_TABLE = "handover_certificates" as any;

export const DATA_BOOK_STATUSES = ["draft", "compiled", "issued"] as const;
export type DataBookStatus = (typeof DATA_BOOK_STATUSES)[number];

/** One open punch-list item, snapshotted at override/issue time — see
 *  20260920050000_conditional_handover.sql. Frozen at that moment on purpose: closing the item
 *  later doesn't rewrite what a Conditional Handover certificate said was open when it was issued. */
export interface ConditionalOpenItem {
  id: string;
  description: string;
  location: string | null;
  due_date: string | null;
  responsible_party_name: string | null;
}

export interface DataBookRow {
  id: string;
  project_id: string;
  book_number: string;
  /** 0 for the first book; incremented by DB trigger for each later book. */
  revision?: number;
  title: string;
  status: DataBookStatus;
  compiled_by: string | null;
  compiled_at: string | null;
  override_open_punch_items: boolean;
  override_reason: string | null;
  override_by: string | null;
  override_items: ConditionalOpenItem[] | null;
  created_at: string;
}

export interface HandoverCertificateRow {
  id: string;
  data_book_id: string;
  certificate_number: string;
  issued_date: string;
  issued_by: string | null;
  received_by_name: string | null;
  received_by_company: string | null;
  acknowledged_at: string | null;
  package_storage_path: string | null;
  package_sha256: string | null;
  is_conditional: boolean;
  conditional_reason: string | null;
  conditional_open_items: ConditionalOpenItem[] | null;
  created_at: string;
}
