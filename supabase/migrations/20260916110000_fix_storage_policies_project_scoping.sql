-- Round-table security finding: the has_org_access() -> has_project_access() fix applied to ~29
-- database tables on 2026-09-14/16 was never extended to Supabase Storage object policies. Every
-- storage.objects policy for project-scoped resources (inspection evidence, vault documents,
-- expected records, generated ITP/inspection/FAT PDFs) still gated purely on org membership, so a
-- project-scoped party (e.g. a subcontractor with an access_grant limited to one project) could
-- read or upload into another project's files in the same org if they obtained the UUID path
-- segment. monthly-reports is correctly left on has_org_access — that report pack genuinely is
-- org-level, not project-scoped.

-- inspection-evidence: general project path (checklist/NCR/inspection photos)
drop policy if exists inspection_evidence_select on storage.objects;
create policy inspection_evidence_select on storage.objects for select using (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and has_project_access(p.id, p.organization_id)
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and has_project_access(p.id, p.organization_id)
    )
  )
);

drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and has_project_access(p.id, p.organization_id)
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and has_project_access(p.id, p.organization_id)
        and is_jags_staff()
    )
  )
);

-- inspection-evidence: vault/ path
drop policy if exists inspection_evidence_vault_select on storage.objects;
create policy inspection_evidence_vault_select on storage.objects for select using (
  bucket_id = 'inspection-evidence'
  and (storage.foldername(name))[1] = 'vault'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(objects.name))[2]
      and has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists inspection_evidence_vault_insert on storage.objects;
create policy inspection_evidence_vault_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (storage.foldername(name))[1] = 'vault'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(objects.name))[2]
      and has_project_access(p.id, p.organization_id)
  )
);

-- inspection-evidence: expected-records/ path
drop policy if exists inspection_evidence_expected_records_select on storage.objects;
create policy inspection_evidence_expected_records_select on storage.objects for select using (
  bucket_id = 'inspection-evidence'
  and (storage.foldername(name))[1] = 'expected-records'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(objects.name))[2]
      and has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists inspection_evidence_expected_records_insert on storage.objects;
create policy inspection_evidence_expected_records_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (storage.foldername(name))[1] = 'expected-records'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(objects.name))[2]
      and has_project_access(p.id, p.organization_id)
  )
);

-- generated-documents: itp PDFs
drop policy if exists generated_documents_itp_pdf_select on storage.objects;
create policy generated_documents_itp_pdf_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'itps'
  and (storage.foldername(name))[2] in (
    select i.id::text from public.itps i join public.projects p on p.id = i.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

-- generated-documents: inspection report PDFs
drop policy if exists generated_documents_inspection_report_select on storage.objects;
create policy generated_documents_inspection_report_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'inspections'
  and (storage.foldername(name))[2] in (
    select r.id::text from public.inspection_records r join public.projects p on p.id = r.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

-- generated-documents: FAT report PDFs
drop policy if exists generated_documents_fat_report_select on storage.objects;
create policy generated_documents_fat_report_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'fat-reports'
  and (storage.foldername(name))[2] in (
    select a.id::text from public.standalone_assignments a join public.projects p on p.id = a.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

-- generated-documents/monthly-reports is deliberately UNTOUCHED: that report pack is genuinely
-- org-level (spans every project an org is licensed for), so has_org_access() is correct there.
