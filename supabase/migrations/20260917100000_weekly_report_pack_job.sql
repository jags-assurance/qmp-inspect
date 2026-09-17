-- Adds the "generate_weekly_report_pack" background job type — the weekly equivalent of the
-- existing "generate_monthly_report_pack" (R109), requested by the CEO alongside the monthly
-- cadence. Same background_jobs -> Railway worker -> Storage upload pattern
-- (worker/src/jobs/generateWeeklyReportPack.ts), same Admin-staff + has_org_access() gate as the
-- monthly job, and covered by the existing per-organisation rate limit
-- (20260917000000_background_jobs_org_rate_limit.sql) via the same `payload ->> 'organization_id'`
-- shape the monthly job already uses.
--
-- background_jobs_insert/background_jobs_select are rebuilt here from the CURRENT shape those
-- policies were left in by 20260916160000_portfolio_summary_pdf_job.sql (the has_project_access()
-- branches for render_itp_pdf/render_inspection_report_pdf/render_fat_report_pdf, is_jags_staff() +
-- has_org_access() for generate_monthly_report_pack, is_jags_staff() alone for
-- render_portfolio_summary_pdf) — not the earlier phase3/phase4 shape — with a new
-- generate_weekly_report_pack branch mirroring generate_monthly_report_pack's exactly.

alter table public.background_jobs drop constraint background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in (
    'render_itp_pdf',
    'generate_monthly_report_pack',
    'generate_weekly_report_pack',
    'render_inspection_report_pdf',
    'render_fat_report_pdf',
    'render_portfolio_summary_pdf'
  ));

drop policy if exists background_jobs_insert on public.background_jobs;
create policy background_jobs_insert on public.background_jobs for insert with check (
  ((job_type = 'render_itp_pdf') and exists (
    select 1 from public.itps i join public.projects p on p.id = i.project_id
    where i.id = ((background_jobs.payload ->> 'itp_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'generate_monthly_report_pack') and is_jags_staff() and (payload ->> 'organization_id') is not null and has_org_access(((payload ->> 'organization_id')::uuid)))
  or ((job_type = 'generate_weekly_report_pack') and is_jags_staff() and (payload ->> 'organization_id') is not null and has_org_access(((payload ->> 'organization_id')::uuid)))
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
    job_type = 'generate_weekly_report_pack'
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

-- Rate-limit resolver (20260917000000) needs to know how to resolve an organisation for the new
-- job_type too, same shape as its 'generate_monthly_report_pack' branch.
create or replace function public.background_jobs_resolve_org_id(p_job_type text, p_payload jsonb)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_job_type
    when 'render_itp_pdf' then (
      select p.organization_id from public.itps i join public.projects p on p.id = i.project_id
      where i.id = (p_payload ->> 'itp_id')::uuid
    )
    when 'generate_monthly_report_pack' then (p_payload ->> 'organization_id')::uuid
    when 'generate_weekly_report_pack' then (p_payload ->> 'organization_id')::uuid
    when 'render_inspection_report_pdf' then (
      select p.organization_id from public.inspection_records r join public.projects p on p.id = r.project_id
      where r.id = (p_payload ->> 'inspection_record_id')::uuid
    )
    when 'render_fat_report_pdf' then (
      select p.organization_id from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where a.id = (p_payload ->> 'assignment_id')::uuid
    )
    else null
  end;
$$;

-- Storage read access for the rendered weekly PDF/CSV, same shape as
-- generated_documents_monthly_reports_select (20260910140000) — path
-- "weekly-reports/{organization_id}/{week_start}/report-pack.{pdf,csv}" in the same bucket.
create policy generated_documents_weekly_reports_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = 'weekly-reports'
    and public.has_org_access(((storage.foldername(name))[2])::uuid)
  );
