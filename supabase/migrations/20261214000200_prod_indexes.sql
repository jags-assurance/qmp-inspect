-- Production indexes. The schema is already well indexed on its foreign keys; these cover the few remaining
-- gaps and the filter pairs the app uses on its busiest pages. All are "if not exists", safe to re-run, and
-- small enough that writes are not noticeably slower.

-- Foreign keys with no index of their own (deletes and joins scan the child table without them).
create index if not exists idx_vault_retention_flags_document on public.vault_retention_flags (document_id);
create index if not exists idx_inspection_correction_requests_signoff on public.inspection_correction_requests (signoff_progress_id);
create index if not exists idx_data_book_issue_snapshots_book on public.data_book_issue_snapshots (data_book_id);

-- Busy-page filter pairs: ITP lists by status, sign-off counts by status, NCR and inspection result counts.
create index if not exists idx_itps_project_status on public.itps (project_id, status);
create index if not exists idx_signoff_progress_item_status on public.activity_signoff_progress (itp_item_id, status);
create index if not exists idx_ncrs_project_status on public.ncrs (project_id, status);
create index if not exists idx_inspection_records_project_result on public.inspection_records (project_id, overall_result);
