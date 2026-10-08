-- projects_u let ANY JAGS staff member (inspectors included) update a project they could reach, and
-- let a self-managed organisation's users change any column (organization_id, status, the
-- allow_* / enforce_* switches, closed_*, responsible_person_id).
-- Every app path that writes those columns is admin-only; this makes the database agree.
--
-- What:
--   1. projects_u: JAGS staff may update only as an Admin (is_admin_staff()). The self-managed
--      branch for the organisation's own non-staff users is unchanged.
--   2. BEFORE UPDATE column guard (same idea as organizations_column_guard): a caller who is not a
--      JAGS Admin may change only the descriptive columns edited on the project details form.
--      Anything else raises 42501. A call with no end-user JWT (service role, SQL editor) and the
--      close_project()/status RPCs (which check admin themselves) are unaffected.
-- Forward-only and idempotent.

drop policy if exists projects_u on public.projects;
create policy projects_u on public.projects
  for update
  using (
    (public.is_admin_staff() and public.has_project_access(id, organization_id))
    or (
      exists (select 1 from public.organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed')
      and public.has_org_wide_access(organization_id)
    )
  )
  with check (
    (public.is_admin_staff() and public.has_project_access(id, organization_id))
    or (
      exists (select 1 from public.organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed')
      and public.has_org_wide_access(organization_id)
    )
  );

create or replace function public.projects_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Columns the project-details form is allowed to change for a non-admin (self-managed) editor.
  v_editable constant text[] := array[
    'project_number', 'name', 'site_location', 'country', 'contract_number',
    'start_date', 'end_date', 'updated_at'
  ];
begin
  -- Service role / SQL editor / migrations: trusted.
  if public.is_system_caller() then
    return new;
  end if;

  -- Admin-ness is read from the stored users row, never from the row being written.
  if public.is_admin_staff() then
    return new;
  end if;

  if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
    raise exception 'Only a JAGS Admin can change this project setting.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.projects_column_guard() from public, anon, authenticated;

drop trigger if exists projects_column_guard on public.projects;
create trigger projects_column_guard
  before update on public.projects
  for each row execute function public.projects_column_guard();
