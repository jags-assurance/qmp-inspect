-- Phase 4: extracted text on vault documents — the missing link for grounding AI ITP/checklist
-- generation in the actual requirement documents a project team attaches (specs, standards,
-- method statements), instead of a free-typed description. Extraction itself happens in the app
-- layer at upload time (apps/web/lib/vault/extract-text.ts, called from
-- apps/web/lib/vault/actions.ts) — this migration only adds the columns it writes into.
--
-- extraction_status distinguishes "not yet processed" from "processed, nothing usable" from
-- "processed, can't be parsed" so the AI-generation document picker can show real state (e.g. a
-- scanned drawing PDF with no text layer is 'unsupported', not silently empty) rather than
-- guessing from extracted_text being null.

alter table public.vault_documents
  add column extracted_text text,
  add column extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'done', 'empty', 'unsupported', 'failed')),
  add column extraction_error text;

comment on column public.vault_documents.extracted_text is
  'Plain text pulled from the uploaded file at upload time (PDF/DOCX/TXT/MD). Null unless extraction_status = ''done''. This is what ITP/checklist AI generation reads — never re-parses the file itself.';
comment on column public.vault_documents.extraction_status is
  'pending = not processed yet; done = extracted_text is usable; empty = parsed but no text found (e.g. scanned image PDF); unsupported = file type not parsed (e.g. .xlsx, images); failed = parsing errored.';

-- Vault-grounded ITP generation now also drives AI checklist-item generation (at "Generate
-- checklists", one activity at a time) — a new ai_usage_log feature value alongside the three from
-- 20260910060000_phase3_ai_usage_log.sql.
alter table public.ai_usage_log drop constraint ai_usage_log_feature_check;
alter table public.ai_usage_log add constraint ai_usage_log_feature_check
  check (feature in ('itp_draft', 'ncr_description_draft', 'checklist_consistency_check', 'checklist_generation'));
