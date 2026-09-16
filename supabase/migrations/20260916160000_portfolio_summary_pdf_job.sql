-- Round-table market-readiness finding: an admin had no one-click way to get a single PDF summary
-- of the whole portfolio to send a stakeholder (they'd have to compile per-project reports by
-- hand). Adds "render_portfolio_summary_pdf" as a new background_jobs job_type, reusing the exact
-- background_jobs -> Railway worker -> Storage pattern already used by render_itp_pdf /
-- generate_monthly_report_pack / render_inspection_report_pdf / render_fat_report_pdf, rather than
-- inventing a new pipeline.
--
-- This is a portfolio-wide (all-organisations) report, so unlike every other job_type here there is
-- no single organization_id/project_id to scope the job ROW to — the with-check/using clauses below
-- gate on is_jags_staff() alone, with no further org/project scoping on the row itself. That is
-- intentionally narrower than it looks: only JAGS staff (is_jags_staff()) can queue or see this job
-- type at all, and the worker (service-role, bypasses RLS) renders the PDF CONTENT straight from
-- every project in the portfolio — which is correct here because this is a JAGS-internal report
-- (an admin summarising the whole book of business for a stakeholder), not a client-facing
-- document scoped to one organisation's own data, so "every JAGS admin sees every project" is the
-- intended behaviour, not a leak.

alter table public.background_jobs drop constraint background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in (
    'render_itp_pdf',
    'generate_monthly_report_pack',
    'render_inspection_report_pdf',
    'render_fat_report_pdf',
    'render_portfolio_summary_pdf'
  ));

-- background_jobs_insert: add the portfolio-summary branch, is_jags_staff()-gated, no org scoping
-- (matches the generate_monthly_report_pack branch's own is_jags_staff() shape, minus
-- has_org_access() since there is no single organization_id on a portfolio-wide job row).
drop policy if exists background_jobs_insert on public.background_jobs;
create policy background_jobs_insert on public.background_jobs for insert with check (
  ((job_type = 'render_itp_pdf') and exists (
    select 1 from public.itps i join public.projects p on p.id = i.project_id
    where i.id = ((background_jobs.payload ->> 'itp_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'generate_monthly_report_pack') and is_jags_staff() and (payload ->> 'organization_id') is not null and has_org_access(((payload ->> 'organization_id')::uuid)))
  or ((job_type = 'render_inspection_report_pdf') and exists (
    select 1 from public.inspection_records r join public.projects p on p.id = r.project_id
    where r.id = ((background_jobs.payload ->> 'inspection_record_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'render_fat_report_pdf') and exists (
    select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
    where a.id = ((background_jobs.payload ->> 'assignment_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'render_portfolio_summary_pdf') and is_jags_staff())
);

-- background_jobs_select: same per-job-type branching pattern as
-- 20260916120000_fix_background_jobs_select_scoping.sql, plus the new portfolio-summary branch.
-- The requester's own jobs remain visible via (payload ->> 'requested_by')::uuid = auth.uid()
-- regardless of job_type, unchanged from that migration.
drop policy if exists background_jobs_select on public.background_jobs;
create policy background_jobs_select on public.background_jobs for select using (
  (payload ->> 'requested_by')::uuid = auth.uid()
  or (
    job_type = 'render_itp_pdf' and exists (
      select 1 from public.itps i join public.projects p on p.id = i.project_id
      where i.id = (background_jobs.payload ->> 'itp_id')::uuid and has_project_access(p.id, p.organization_id)
    )
  )
  or (
    job_type = 'generate_monthly_report_pack'
    and is_jags_staff()
    and (payload ->> 'organization_id') is not null
    and has_org_access((payload ->> 'organization_id')::uuid)
  )
  or (
    job_type = 'render_inspection_report_pdf' and exists (
      select 1 from public.inspection_records r join public.projects p on p.id = r.project_id
      where r.id = (background_jobs.payload ->> 'inspection_record_id')::uuid and has_project_access(p.id, p.organization_id)
    )
  )
  or (
    job_type = 'render_fat_report_pdf' and exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where a.id = (background_jobs.payload ->> 'assignment_id')::uuid and has_project_access(p.id, p.organization_id)
    )
  )
  or (
    job_type = 'render_portfolio_summary_pdf' and is_jags_staff()
  )
);

-- Storage read access at path portfolio-summary/{job_id}/report-pack.pdf in the shared
-- "generated-documents" bucket — is_jags_staff()-gated to match the row-level policies above (this
-- is the one report in this bucket with no organization_id/project_id segment to scope by).
create policy generated_documents_portfolio_summary_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = 'portfolio-summary'
    and public.is_jags_staff()
  );
