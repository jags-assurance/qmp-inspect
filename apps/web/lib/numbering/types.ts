// Domain types + table-name handles for `numbering_configs` and `document_sequences`
// (supabase/migrations/20260910020000_phase2_numbering_engine.sql).
//
// Neither table is in the generated Database type yet — same documented cast pattern as
// apps/web/lib/ncrs/types.ts and apps/web/lib/vault/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const NUMBERING_CONFIGS_TABLE = "numbering_configs" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const DOCUMENT_SEQUENCES_TABLE = "document_sequences" as any;

export const NUMBERING_DOC_TYPES = [
  "itp",
  "ncr",
  "checklist",
  "irn",
  "standalone_assignment",
  "vault_document",
] as const;
export type NumberingDocType = (typeof NUMBERING_DOC_TYPES)[number];

export interface NumberingConfigRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  doc_type: NumberingDocType;
  client_code: string;
  originator_code: string;
  separator: string;
  sequence_padding: number;
  include_year: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentSequenceRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  doc_type: string;
  current_number: number;
  updated_at: string;
}
