-- Trigram indexes for the Ctrl+K record search (lib/search/actions.ts), which runs
-- column ilike '%term%' on exactly these columns. Without them every keystroke-debounced search scans
-- the tables. Idempotent. Indexes are plain CREATE INDEX (migration runs in a transaction): short write
-- lock while building; apply in a quiet minute.
--
-- Only columns the search actually queries are indexed (projects, ncrs, itps, inspection_records).
-- vault_documents and punch_list_items are not part of the palette search today; add indexes when
-- they are.
--
-- Rollback: drop index if exists public.projects_name_trgm_idx, public.projects_number_trgm_idx,
--   public.ncrs_number_trgm_idx, public.ncrs_description_trgm_idx, public.itps_number_trgm_idx,
--   public.itps_title_trgm_idx, public.inspection_records_number_trgm_idx,
--   public.inspection_records_activity_trgm_idx;  (the extension is left installed)

create extension if not exists pg_trgm with schema extensions;

create index if not exists projects_name_trgm_idx on public.projects using gin (name extensions.gin_trgm_ops);
create index if not exists projects_number_trgm_idx on public.projects using gin (project_number extensions.gin_trgm_ops);
create index if not exists ncrs_number_trgm_idx on public.ncrs using gin (ncr_number extensions.gin_trgm_ops);
create index if not exists ncrs_description_trgm_idx on public.ncrs using gin (description extensions.gin_trgm_ops);
create index if not exists itps_number_trgm_idx on public.itps using gin (itp_number extensions.gin_trgm_ops);
create index if not exists itps_title_trgm_idx on public.itps using gin (title extensions.gin_trgm_ops);
create index if not exists inspection_records_number_trgm_idx on public.inspection_records using gin (record_number extensions.gin_trgm_ops);
create index if not exists inspection_records_activity_trgm_idx on public.inspection_records using gin (activity extensions.gin_trgm_ops);
