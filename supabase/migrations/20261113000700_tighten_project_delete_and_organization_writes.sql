-- Cross-check follow-up to audit finding C2 (inspectors holding admin powers at the database).
-- What was still open after the earlier fixes:
--   * projects_d: ANY JAGS staff member with access to a project could DELETE it through the API (the app
--     has no project delete at all).
--   * organizations_update: ANY JAGS staff member, and any user holding a project grant in a self-managed
--     organisation, could UPDATE every column of an organisation row.
--   * The self-managed / client-managed branding policy lets an organisation-wide client user update the row
--     but never limited WHICH columns, so such a user could rewrite engagement_scope (widening their own
--     powers), the AI consent flag or the plan fields.
-- After this: project deletes are Admin-only; organisation updates are Admin-only except that an
-- organisation-wide client user of a self- or client-managed organisation may change the brand columns the
-- branding screen writes, and nothing else. System callers and nested trigger calls are exempt. Idempotent.

drop policy if exists projects_d on public.projects;
create policy projects_d on public.projects
  for delete using (public.is_admin_staff() and public.has_project_access(id, organization_id));

-- The staff path becomes Admin-only. The self-managed client path is already covered, with the stricter
-- organisation-wide-grant rule, by organizations_self_managed_branding_update (20261005090000).
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update
  using (public.is_admin_staff())
  with check (public.is_admin_staff());

create or replace function public.organizations_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_brand constant text[] := array[
    'brand_primary_color', 'brand_accent_color', 'brand_extra_colors', 'brand_multi_color_mode', 'branding_logo_path'
  ];
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 or public.is_admin_staff() then
    return new;
  end if;
  if public.is_jags_staff() then
    raise exception 'Only a JAGS Admin can change an organisation.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_brand) is distinct from (to_jsonb(old) - v_brand) then
    raise exception 'You can only change the organisation''s brand settings.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.organizations_column_guard() from public, anon, authenticated;

drop trigger if exists organizations_column_guard on public.organizations;
create trigger organizations_column_guard
  before update on public.organizations
  for each row execute function public.organizations_column_guard();
