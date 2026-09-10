-- Phase 1: RLS policies on storage.objects for the two buckets this app writes evidence/documents
-- to. Both buckets are private — no policy at all means even a signed-in user gets denied, so this
-- migration is what actually makes upload/download work, not just bucket existence.
--
-- "inspection-evidence" holds two distinct path shapes, one per feature that uploads to it:
--   {project_id}/{inspection_record_id}/{filename}   -- checklist/inspection photos
--   standalone/{assignment_id}/{filename}             -- standalone/FAT assignment photos
-- "generated-documents" holds worker-rendered PDFs at itps/{itp_id}/{filename}; the worker uploads
-- with the service-role key (bypasses RLS entirely), so this bucket only needs a SELECT policy for
-- authenticated users downloading their own org's documents — no INSERT policy for that bucket.

create policy inspection_evidence_select on storage.objects
  for select using (
    bucket_id = 'inspection-evidence'
    and (
      exists (
        select 1 from public.projects p
        where p.id::text = (storage.foldername(name))[1]
          and public.has_org_access(p.organization_id)
      )
      or exists (
        select 1 from public.standalone_assignments a
        join public.projects p on p.id = a.project_id
        where (storage.foldername(name))[1] = 'standalone'
          and a.id::text = (storage.foldername(name))[2]
          and public.has_org_access(p.organization_id)
      )
    )
  );

create policy inspection_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and (
      exists (
        select 1 from public.projects p
        where p.id::text = (storage.foldername(name))[1]
          and public.has_org_access(p.organization_id)
      )
      or exists (
        select 1 from public.standalone_assignments a
        join public.projects p on p.id = a.project_id
        where (storage.foldername(name))[1] = 'standalone'
          and a.id::text = (storage.foldername(name))[2]
          and public.has_org_access(p.organization_id)
      )
    )
  );

create policy generated_documents_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where (storage.foldername(name))[1] = 'itps'
        and i.id::text = (storage.foldername(name))[2]
        and public.has_org_access(p.organization_id)
    )
  );
