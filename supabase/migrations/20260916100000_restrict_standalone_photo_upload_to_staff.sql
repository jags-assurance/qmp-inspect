-- Standalone assignment field data entry (measurements, punch items, photos, signatures) is
-- staff-only at the app layer (lib/standalone/actions.ts checks session.isJagsStaff on every
-- mutation) — but the "inspection_evidence" bucket's INSERT policy for the standalone/{project}/
-- {assignment}/... path only checked has_org_access, letting any project party (client,
-- subcontractor, TPI) push bytes into storage for a standalone assignment even though the
-- corresponding addPhotoAction row-insert would then correctly reject them. Low severity (no data
-- exposure, just an orphaned unlisted file a non-staff upload attempt could leave behind), but the
-- storage layer should match the same rule the app layer already enforces.
--
-- The sibling "projects/{project}/..." branch of this same policy is untouched — that path is used
-- by checklist/NCR photo uploads where a self-inspecting assigned party legitimately can upload,
-- per this session's earlier fix restricting checklist execution to the performing contractor.

drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and has_org_access(p.organization_id)
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and has_org_access(p.organization_id)
        and is_jags_staff()
    )
  )
);
