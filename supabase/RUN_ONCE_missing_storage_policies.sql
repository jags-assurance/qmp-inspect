-- RUN THIS ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- Diagnosis (2026-09-14): every file upload on the live app — Document Vault, checklist/inspection
-- photos, standalone/FAT evidence — fails with "new row violates row-level security policy". This
-- was confirmed by directly replicating the browser's authenticated Storage upload call as the
-- admin user: it's denied for every path shape in the inspection-evidence bucket, even though
-- has_org_access() itself works correctly (verified separately via RPC). That means the
-- storage.objects RLS policies from the migrations below were never actually applied to this
-- database — the migration FILES exist in supabase/migrations/ and are correct, they just never ran
-- here (a different history than the earlier "9 migrations applied via one-off pg script" pass this
-- project went through before this became the live/production Supabase project).
--
-- This script is idempotent (safe to re-run) — every policy is dropped first if it exists, then
-- recreated. It changes nothing else: no table schema, no data. Combines, in their FINAL/superseding
-- form, every storage.objects policy from:
--   20260909280000_phase1_storage_policies.sql
--   20260910010000_phase2_document_vault.sql
--   20260910140000_phase3_monthly_report_pack_storage_policy.sql
--   20260910150000 + 20260910160000 (itp pdf select — v2 supersedes v1, only v2 included here)
--   20260910120000_phase3_activity_expected_records.sql
--   20260911010000_phase4_inspection_report_pdf_job.sql
--   20260911020000_phase4_fat_report_pdf_job.sql
-- If a later migration adds a new storage policy going forward, it'll apply correctly via the normal
-- migration path (`db:push`) once this script has brought storage.objects up to date with everything
-- that came before it — this is a one-time catch-up, not a new standing process.

-- ============================================================================================
-- Bucket: inspection-evidence
-- ============================================================================================

drop policy if exists inspection_evidence_select on storage.objects;
create policy inspection_evidence_select on storage.objects
  for select using (
    bucket_id = 'inspection-evidence'
    and (
      exists (
        select 1 from public.projects p
        where p.id::text = (storage.foldername(storage.objects.name))[1]
          and public.has_org_access(p.organization_id)
      )
      or exists (
        select 1 from public.standalone_assignments a
        join public.projects p on p.id = a.project_id
        where (storage.foldername(storage.objects.name))[1] = 'standalone'
          and a.id::text = (storage.foldername(storage.objects.name))[2]
          and public.has_org_access(p.organization_id)
      )
    )
  );

drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and (
      exists (
        select 1 from public.projects p
        where p.id::text = (storage.foldername(storage.objects.name))[1]
          and public.has_org_access(p.organization_id)
      )
      or exists (
        select 1 from public.standalone_assignments a
        join public.projects p on p.id = a.project_id
        where (storage.foldername(storage.objects.name))[1] = 'standalone'
          and a.id::text = (storage.foldername(storage.objects.name))[2]
          and public.has_org_access(p.organization_id)
      )
    )
  );

drop policy if exists inspection_evidence_vault_select on storage.objects;
create policy inspection_evidence_vault_select on storage.objects
  for select using (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(storage.objects.name))[1] = 'vault'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(storage.objects.name))[2]
        and public.has_org_access(p.organization_id)
    )
  );

drop policy if exists inspection_evidence_vault_insert on storage.objects;
create policy inspection_evidence_vault_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(storage.objects.name))[1] = 'vault'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(storage.objects.name))[2]
        and public.has_org_access(p.organization_id)
    )
  );

drop policy if exists inspection_evidence_expected_records_select on storage.objects;
create policy inspection_evidence_expected_records_select on storage.objects
  for select using (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(storage.objects.name))[1] = 'expected-records'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(storage.objects.name))[2]
        and public.has_org_access(p.organization_id)
    )
  );

drop policy if exists inspection_evidence_expected_records_insert on storage.objects;
create policy inspection_evidence_expected_records_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(storage.objects.name))[1] = 'expected-records'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(storage.objects.name))[2]
        and public.has_org_access(p.organization_id)
    )
  );

-- ============================================================================================
-- Bucket: generated-documents (worker uploads with the service-role key, bypassing RLS — these
-- are SELECT-only policies so authenticated users can download their own org's PDFs)
-- ============================================================================================

drop policy if exists generated_documents_select on storage.objects;
drop policy if exists generated_documents_itp_pdf_select on storage.objects;
create policy generated_documents_itp_pdf_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'itps'
    and (storage.foldername(storage.objects.name))[2] in (
      select i.id::text
      from public.itps i
      join public.projects p on p.id = i.project_id
      where public.has_org_access(p.organization_id)
    )
  );

drop policy if exists generated_documents_monthly_reports_select on storage.objects;
create policy generated_documents_monthly_reports_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(storage.objects.name))[1] = 'monthly-reports'
    and public.has_org_access(((storage.foldername(storage.objects.name))[2])::uuid)
  );

drop policy if exists generated_documents_inspection_report_select on storage.objects;
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

drop policy if exists generated_documents_fat_report_select on storage.objects;
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

-- ============================================================================================
-- Verify: lists every policy now on storage.objects for these two buckets. Expect 11 rows total
-- (7 inspection-evidence, 4 generated-documents) after running this script.
-- ============================================================================================
select policyname, cmd, qual is not null as has_using, with_check is not null as has_with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
