-- Weekly / monthly report packs and the portfolio summary are admin-only in the app, but the
-- background_jobs insert policy only required is_jags_staff(), so an inspector could queue them
-- through the API. Require is_admin_staff() for those three job types; everything else is unchanged.
drop policy if exists background_jobs_insert on public.background_jobs;
create policy background_jobs_insert on public.background_jobs for insert with check (
  ((job_type = 'render_itp_pdf') and exists (select 1 from itps i join projects p on p.id = i.project_id where i.id = ((background_jobs.payload ->> 'itp_id'))::uuid and has_project_access(p.id, p.organization_id)))
  or ((job_type = 'generate_monthly_report_pack') and is_admin_staff() and ((payload ->> 'organization_id') is not null) and has_org_access(((payload ->> 'organization_id'))::uuid))
  or ((job_type = 'generate_weekly_report_pack') and is_admin_staff() and ((payload ->> 'organization_id') is not null) and has_org_access(((payload ->> 'organization_id'))::uuid))
  or ((job_type = 'render_inspection_report_pdf') and exists (select 1 from inspection_records r join projects p on p.id = r.project_id where r.id = ((background_jobs.payload ->> 'inspection_record_id'))::uuid and has_project_access(p.id, p.organization_id)))
  or ((job_type = 'render_fat_report_pdf') and exists (select 1 from standalone_assignments a join projects p on p.id = a.project_id where a.id = ((background_jobs.payload ->> 'assignment_id'))::uuid and has_project_access(p.id, p.organization_id)))
  or ((job_type = 'render_portfolio_summary_pdf') and is_admin_staff())
  or ((job_type = 'render_ncr_pdf') and exists (select 1 from ncrs n join projects p on p.id = n.project_id where n.id = ((background_jobs.payload ->> 'ncr_id'))::uuid and has_project_access(p.id, p.organization_id)))
  or ((job_type = 'render_irn_pdf') and exists (select 1 from irns irn join inspection_records r on r.id = irn.inspection_record_id join projects p on p.id = r.project_id where irn.id = ((background_jobs.payload ->> 'irn_id'))::uuid and has_project_access(p.id, p.organization_id)))
  or ((job_type = 'render_data_book_pdf') and exists (select 1 from data_books d join projects p on p.id = d.project_id where d.id = ((background_jobs.payload ->> 'data_book_id'))::uuid and has_project_access(p.id, p.organization_id)))
  or ((job_type = 'render_ncr_closeout_certificate') and exists (select 1 from ncrs n join projects p on p.id = n.project_id where n.id = ((background_jobs.payload ->> 'ncr_id'))::uuid and has_project_access(p.id, p.organization_id)))
);
