-- Adds the "render_audit_trail_pdf" background job type: a project's audit log (with the audit-log page's
-- filters) rendered to a landscape A4 PDF by the worker (renderAuditTrailPdf.ts). JAGS staff only,
-- matching who can view the audit log. Forward-only and idempotent.
--
-- The existing long per-job-type background_jobs insert/select policies are left untouched: the new
-- branches are ADDITIVE permissive policies (permissive policies OR together), the same approach
-- 20261017S60004 and 20261101000200 took. The restrictive requester policy from 20261017S60004
-- (payload.requested_by = auth.uid()) still applies to every insert.
--
-- background_jobs_resolve_org_id() is deliberately not touched: for an unknown job type it returns null,
-- which the org rate-limit trigger treats as "nothing to rate-limit" (the web action de-duplicates an
-- in-flight audit-trail job per project instead).

-- 1. Allow the new job_type (list = 20260927010000's, plus the new one).
alter table public.background_jobs drop constraint if exists background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in (
    'render_itp_pdf',
    'generate_monthly_report_pack',
    'generate_weekly_report_pack',
    'render_inspection_report_pdf',
    'render_fat_report_pdf',
    'render_portfolio_summary_pdf',
    'render_ncr_pdf',
    'render_irn_pdf',
    'render_data_book_pdf',
    'render_ncr_closeout_certificate',
    'render_audit_trail_pdf'
  ));

-- 2. Queue it: JAGS staff with access to the project in the payload.
drop policy if exists background_jobs_insert_audit_trail on public.background_jobs;
create policy background_jobs_insert_audit_trail on public.background_jobs
  for insert with check (
    job_type = 'render_audit_trail_pdf'
    and public.is_jags_staff()
    and exists (
      select 1 from public.projects p
      where p.id = (background_jobs.payload ->> 'project_id')::uuid
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- 3. Read the job row's status back (the requester can already via background_jobs_select; this lets the
--    same staff member's polling keep working identically to the other PDF jobs).
drop policy if exists background_jobs_select_audit_trail on public.background_jobs;
create policy background_jobs_select_audit_trail on public.background_jobs
  for select using (
    job_type = 'render_audit_trail_pdf'
    and public.is_jags_staff()
    and exists (
      select 1 from public.projects p
      where p.id = (background_jobs.payload ->> 'project_id')::uuid
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- 4. Storage read for the rendered file at audit-trails/{project_id}/{filename} in generated-documents.
drop policy if exists generated_documents_audit_trail_select on storage.objects;
create policy generated_documents_audit_trail_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'audit-trails'
    and public.is_jags_staff()
    and (storage.foldername(storage.objects.name))[2] in (
      select p.id::text
      from public.projects p
      where public.has_org_access(p.organization_id)
    )
  );
