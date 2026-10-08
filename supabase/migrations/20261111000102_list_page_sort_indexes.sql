-- Perf: indexes that match the ORDER BY of the (now windowed / paginated) list pages. Idempotent,
-- additive, no data change.
--
-- The list pages read "newest N" with LIMIT / range():
--   punch list          where project_id = ? and status = ? order by created_at desc limit N
--   vault folder        where folder_id = ?               order by created_at desc limit N
--   inspections / NCRs  order by inspection_date desc, created_at desc / created_at desc range(...)
-- A bare (project_id) / (folder_id) index finds the rows but still sorts them all before the LIMIT
-- applies; these composite indexes let Postgres read the first N rows in index order instead.
-- (audit_log already has (project_id, created_at desc) from 20261104000300.)

create index if not exists punch_list_items_project_status_created_idx
  on public.punch_list_items (project_id, status, created_at desc);

create index if not exists vault_documents_folder_created_idx
  on public.vault_documents (folder_id, created_at desc);

create index if not exists inspection_records_project_date_idx
  on public.inspection_records (project_id, inspection_date desc, created_at desc);

create index if not exists inspection_records_date_idx
  on public.inspection_records (inspection_date desc, created_at desc);

create index if not exists ncrs_project_created_idx
  on public.ncrs (project_id, created_at desc);
