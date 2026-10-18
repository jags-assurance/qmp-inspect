-- Deterministic filing path for auto-filed generated documents: "project / discipline / ITP / activity".
-- Vault folders stay the fixed per-project categories (many callers depend on folder_key); the path is
-- metadata on the document, written by the worker (worker/src/jobs/vaultAutoFile.ts, filingPath) and used
-- by the whole-project zip to lay files out below the category folder. Nullable: manual uploads and
-- documents filed before this migration have none. Written by service-role only (the immutability guard
-- lets auth.uid() IS NULL writes through; end users never set it).
-- NOT applied by the code author: apply through the normal migration flow.
alter table public.vault_documents add column if not exists filing_path text;

comment on column public.vault_documents.filing_path is
  'Deterministic "project / discipline / ITP / activity" path of an auto-filed generated record (worker-written).';
