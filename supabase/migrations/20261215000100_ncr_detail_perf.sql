-- NCR detail page: the PDF-status lookup filters background_jobs on payload->>'ncr_id' and the history
-- lookup filters audit_log on (entity_type, entity_id); neither had a matching index, so each page load
-- scanned both tables and could exhaust the free plan's Disk IO. All "if not exists", safe to re-run.
create index if not exists background_jobs_ncr_pdf_idx
  on public.background_jobs ((payload->>'ncr_id'), created_at desc)
  where job_type = 'render_ncr_pdf';
create index if not exists background_jobs_ncr_closeout_idx
  on public.background_jobs ((payload->>'ncr_id'), created_at desc)
  where job_type = 'render_ncr_closeout_certificate';
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index if not exists ncr_photos_ncr_idx on public.ncr_photos (ncr_id, created_at);
