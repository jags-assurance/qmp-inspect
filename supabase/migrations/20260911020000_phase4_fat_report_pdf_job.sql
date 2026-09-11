-- Phase 4: adds the "render_fat_report_pdf" background job type (R14 — the branded FAT/Inspection
-- Report/Test Certificate that IS the deliverable for a standalone assignment). Same
-- background_jobs -> Railway worker -> Storage pattern as the other two render_* job types.

alter table public.background_jobs drop constraint background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in (
    'render_itp_pdf',
    'generate_monthly_report_pack',
    'render_inspection_report_pdf',
    'render_fat_report_pdf'
  ));

drop policy background_jobs_insert on public.background_jobs;

create policy background_jobs_insert on public.background_jobs
  for insert to authenticated
  with check (
    (
      job_type = 'render_itp_pdf'
      and exists (
        select 1 from public.itps i
        join public.projects p on p.id = i.project_id
        where i.id = (payload ->> 'itp_id')::uuid
          and public.has_org_access(p.organization_id)
      )
    )
    or (
      job_type = 'generate_monthly_report_pack'
      and public.is_jags_staff()
      and (payload ->> 'organization_id') is not null
      and public.has_org_access((payload ->> 'organization_id')::uuid)
    )
    or (
      job_type = 'render_inspection_report_pdf'
      and exists (
        select 1 from public.inspection_records r
        join public.projects p on p.id = r.project_id
        where r.id = (payload ->> 'inspection_record_id')::uuid
          and public.has_org_access(p.organization_id)
      )
    )
    or (
      job_type = 'render_fat_report_pdf'
      and exists (
        select 1 from public.standalone_assignments a
        join public.projects p on p.id = a.project_id
        where a.id = (payload ->> 'assignment_id')::uuid
          and public.has_org_access(p.organization_id)
      )
    )
  );

-- Storage read access at path fat-reports/{assignment_id}/{filename} in the shared
-- "generated-documents" bucket.
create policy generated_documents_fat_report_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'fat-reports'
    and (storage.foldername(storage.objects.name))[2] in (
      select a.id::text
      from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where public.has_org_access(p.organization_id)
    )
  );
