// Table-name handles for `standalone_assignments` and its child tables
// (supabase/migrations/20260909260000_phase1_standalone_assignments.sql).
//
// Not in the generated Database type yet — `as any` on the relation name is the narrowest way to
// bypass that gap, same documented pattern as apps/web/lib/ncrs/types.ts and
// apps/web/lib/vault/types.ts. Every call site still gets a properly-typed result via
// `.returns<T>()`, so nothing downstream loses type safety.
//
// Lives here (not lib/standalone/actions.ts) because that file has "use server" at the top, which
// restricts it to exporting only async functions — a plain string constant can't live there.
/* eslint-disable @typescript-eslint/no-explicit-any -- narrow, documented escape hatch, see above */
export const STANDALONE_ASSIGNMENTS = "standalone_assignments" as any;
export const STANDALONE_ASSIGNMENT_MEASUREMENTS = "standalone_assignment_measurements" as any;
export const STANDALONE_ASSIGNMENT_PHOTOS = "standalone_assignment_photos" as any;
export const STANDALONE_ASSIGNMENT_PUNCH_ITEMS = "standalone_assignment_punch_items" as any;
export const STANDALONE_ASSIGNMENT_SIGNATURES = "standalone_assignment_signatures" as any;
// Evidence-document links (20260929050000_standalone_assignment_evidence_documents.sql) — mirrors
// the same "link an existing vault document as evidence" mechanism just built for ITP items
// (itp_item_evidence_documents), not a second upload path.
export const STANDALONE_ASSIGNMENT_EVIDENCE_DOCUMENTS = "standalone_assignment_evidence_documents" as any;
/* eslint-enable @typescript-eslint/no-explicit-any */
