-- R108: adds the "render_irn_pdf" and "render_data_book_pdf" background job types. A prior audit
-- found real PDF generators already existed for ITP, Inspection Report, FAT Report and NCR — but an
-- IRN (Inspection Release Note) was only ever a DB row (the `irns` table), and a Data Book had real
-- readiness/compile/issue logic (data_books) but nothing rendered it as a document. Same
-- background_jobs -> Railway worker -> Storage pattern as every other job type here.
--
-- background_jobs_insert/background_jobs_select are rebuilt here from the CURRENT shape those
-- policies were left in by 20260920020000_ncr_pdf_job.sql, plus two new branches:
--   render_irn_pdf       -> has_project_access() on the IRN's inspection record's project (mirrors
--                            render_inspection_report_pdf's own branch, since an IRN's only FK is to
--                            inspection_records, not directly to projects).
--   render_data_book_pdf -> has_project_access() on the data book's project directly (data_books has
--                            its own project_id column, unlike irns).

alter table public.background_jobs drop constraint background_jobs_job_type_check;
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
    'render_data_book_pdf'
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
  or ((job_type = 'render_ncr_pdf') and exists (
    select 1 from public.ncrs n join public.projects p on p.id = n.project_id
    where n.id = ((background_jobs.payload ->> 'ncr_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'render_irn_pdf') and exists (
    select 1 from public.irns irn
    join public.inspection_records r on r.id = irn.inspection_record_id
    join public.projects p on p.id = r.project_id
    where irn.id = ((background_jobs.payload ->> 'irn_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
  or ((job_type = 'render_data_book_pdf') and exists (
    select 1 from public.data_books d join public.projects p on p.id = d.project_id
    where d.id = ((background_jobs.payload ->> 'data_book_id')::uuid) and has_project_access(p.id, p.organization_id)
  ))
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
  or (
    job_type = 'render_ncr_pdf' and exists (
      select 1 from public.ncrs n join public.projects p on p.id = n.project_id
      where n.id = (background_jobs.payload ->> 'ncr_id')::uuid and has_project_access(p.id, p.organization_id)
    )
  )
  or (
    job_type = 'render_irn_pdf' and exists (
      select 1 from public.irns irn
      join public.inspection_records r on r.id = irn.inspection_record_id
      join public.projects p on p.id = r.project_id
      where irn.id = (background_jobs.payload ->> 'irn_id')::uuid and has_project_access(p.id, p.organization_id)
    )
  )
  or (
    job_type = 'render_data_book_pdf' and exists (
      select 1 from public.data_books d join public.projects p on p.id = d.project_id
      where d.id = (background_jobs.payload ->> 'data_book_id')::uuid and has_project_access(p.id, p.organization_id)
    )
  )
);

-- Rate-limit resolver (20260917000000) needs to know how to resolve an organisation for the two new
-- job_types too, same shape as its 'render_ncr_pdf' branch.
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
    when 'render_ncr_pdf' then (
      select p.organization_id from public.ncrs n join public.projects p on p.id = n.project_id
      where n.id = (p_payload ->> 'ncr_id')::uuid
    )
    when 'render_irn_pdf' then (
      select p.organization_id
      from public.irns irn
      join public.inspection_records r on r.id = irn.inspection_record_id
      join public.projects p on p.id = r.project_id
      where irn.id = (p_payload ->> 'irn_id')::uuid
    )
    when 'render_data_book_pdf' then (
      select p.organization_id from public.data_books d join public.projects p on p.id = d.project_id
      where d.id = (p_payload ->> 'data_book_id')::uuid
    )
    else null
  end;
$$;

-- Storage read access for the two rendered PDFs, at paths irns/{irn_id}/{filename} and
-- databooks/{data_book_id}/{filename} in the shared "generated-documents" bucket every other
-- rendered document uses.
create policy generated_documents_irn_pdf_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'irns'
    and (storage.foldername(storage.objects.name))[2] in (
      select irn.id::text
      from public.irns irn
      join public.inspection_records r on r.id = irn.inspection_record_id
      join public.projects p on p.id = r.project_id
      where public.has_org_access(p.organization_id)
    )
  );

create policy generated_documents_data_book_pdf_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'databooks'
    and (storage.foldername(storage.objects.name))[2] in (
      select d.id::text
      from public.data_books d
      join public.projects p on p.id = d.project_id
      where public.has_org_access(p.organization_id)
    )
  );
