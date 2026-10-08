-- 20261105000100 recreated inspection_evidence_insert (project-scoped) but dropped the
-- <project>/registers/ restriction that 20261103000100 added: that folder only takes uploads from JAGS
-- staff or the project's register contributors, limited to document / image types. The live database
-- was patched by hand to keep it; this brings a database built from the repo in line. Idempotent.
drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and public.has_project_access(p.id, p.organization_id)
        and (
          (storage.foldername(objects.name))[2] is distinct from 'registers'
          or (
            (public.is_jags_staff() or public.is_register_contributor(p.id))
            and lower(objects.name) ~ '\.(pdf|png|jpe?g|webp|heic|docx?|xlsx?)$'
          )
        )
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and public.has_project_access(p.id, p.organization_id)
        and public.can_run_standalone_assignment(a.project_id)
    )
  )
);
