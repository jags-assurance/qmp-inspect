-- Phase 1 security closure. Idempotent; no data changes.
--
-- H3 / M1  has_custom_permission() matched ANY assignment of a role holding the key, so a role defined
--          for organisation A (custom_roles.organization_id = A) and assigned project-wide/globally
--          (project_id null) counted for every project in every organisation. It now also requires the
--          role to be a JAGS-global role (organization_id null) or to belong to the organisation that
--          owns the project being checked. When no project is passed (org/platform-wide check) only
--          global roles and project-less assignments of any role still match, as before.
-- H7       inspection-evidence uploads were allowed to anyone with access to ANY project of the
--          organisation (has_org_access). The project folder is now checked with has_project_access, so
--          an upload needs access to that project itself.

create or replace function public.has_custom_permission(
  target_user_id uuid,
  target_permission_key text,
  target_project_id uuid default null
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.custom_role_assignments a
    join public.custom_role_permissions p on p.role_id = a.role_id
    join public.custom_roles r on r.id = a.role_id
    where a.user_id = target_user_id
      and p.permission_key = target_permission_key
      and (a.project_id is null or a.project_id = target_project_id)
      and (
        r.organization_id is null
        or target_project_id is null
        or r.organization_id = (select pr.organization_id from public.projects pr where pr.id = target_project_id)
      )
  );
$$;

drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and public.has_project_access(p.id, p.organization_id)
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
