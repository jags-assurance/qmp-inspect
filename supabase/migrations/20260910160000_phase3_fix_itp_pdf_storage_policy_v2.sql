-- The previous fix (20260910150000) made the exact same mistake it was fixing: an unqualified
-- `name` reference inside a subquery that joins to `projects` (which also has a `name` column) gets
-- resolved by Postgres to the SUBQUERY's own `projects.name`, not the outer `storage.objects.name`,
-- because unqualified column references bind to the innermost enclosing scope that has a match.
-- Confirmed live via `select qual from pg_policies` after applying 20260910150000 — the stored
-- policy showed `storage.foldername(p.name)` despite the migration file itself reading
-- `storage.foldername(name)`; Postgres silently re-resolved it at CREATE POLICY time.
--
-- This version sidesteps the whole ambiguity class rather than relying on qualifier resolution:
-- every reference to the object's own path uses the fully schema-qualified `storage.objects.name`
-- (always unambiguous), and the subquery never selects or filters on `projects.name` at all — it
-- only returns `itps.id`, so there is nothing named `name` in its scope to collide with.
drop policy generated_documents_itp_pdf_select on storage.objects;

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
