-- Phase 4: adds the "render_inspection_report_pdf" background job type (R63-R65, R108 — the
-- branded A4 Inspection Report, the general-purpose companion to the IRN certificate). Same
-- background_jobs -> Railway worker -> Storage pattern as render_itp_pdf and
-- generate_monthly_report_pack (20260909270000_phase1_background_jobs.sql,
-- 20260910130000_phase3_monthly_report_pack_job.sql) — no new table, no new pipeline.

alter table public.background_jobs drop constraint background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in ('render_itp_pdf', 'generate_monthly_report_pack', 'render_inspection_report_pdf'));

drop policy background_jobs_insert on public.background_jobs;

-- Same shape as the render_itp_pdf branch: any authenticated user with org access to the
-- inspection record's project may request a render (viewing the record already implies that
-- access via inspection_records' own select policy) — the worker renders as service role
-- regardless, so authorization happens here at insert time.
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
  );

-- Storage read access for the rendered PDF, at path inspections/{inspection_record_id}/{filename}
-- in the same "generated-documents" bucket the ITP PDF and monthly report packs already use.
-- Mirrors generated_documents_itp_pdf_select's fully-qualified-column fix
-- (20260910160000_phase3_fix_itp_pdf_storage_policy_v2.sql) rather than repeating its bug.
create policy generated_documents_inspection_report_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'inspections'
    and (storage.foldername(storage.objects.name))[2] in (
      select r.id::text
      from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where public.has_org_access(p.organization_id)
    )
  );
