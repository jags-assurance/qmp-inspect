-- Self-/client-managed organisations: only users with an ORGANISATION-WIDE (or global) grant may edit
-- the org's branding, numbering and custom roles. has_org_access() also passes for a project-scoped
-- grant, which is what a contractor or party user holds, so those users could write these settings.
create or replace function public.has_org_wide_access(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.access_grants
    where user_id = auth.uid()
      and (scope_type = 'global' or (scope_type = 'organization' and organization_id = target_org_id))
  );
$$;

drop policy if exists numbering_configs_self_managed_write on public.numbering_configs;
create policy numbering_configs_self_managed_write on public.numbering_configs
  for all
  using (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_wide_access(organization_id)
  )
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_wide_access(organization_id)
  );

drop policy if exists organizations_self_managed_branding_update on public.organizations;
create policy organizations_self_managed_branding_update on public.organizations
  for update
  using (engagement_scope in ('self_managed', 'client_managed') and public.has_org_wide_access(id))
  with check (engagement_scope in ('self_managed', 'client_managed') and public.has_org_wide_access(id));

drop policy if exists custom_roles_self_managed_write on public.custom_roles;
create policy custom_roles_self_managed_write on public.custom_roles
  for all
  using (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.id = custom_roles.organization_id and o.engagement_scope in ('self_managed', 'client_managed')
    )
    and public.has_org_wide_access(organization_id)
  )
  with check (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.id = custom_roles.organization_id and o.engagement_scope in ('self_managed', 'client_managed')
    )
    and public.has_org_wide_access(organization_id)
  );

drop policy if exists custom_role_permissions_self_managed_write on public.custom_role_permissions;
create policy custom_role_permissions_self_managed_write on public.custom_role_permissions
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(r.organization_id)
    )
    and (
      custom_role_permissions.permission_key in ('add_project_party', 'reassign_project_party', 'view_org_reports')
      or (
        custom_role_permissions.permission_key in ('approve_itp', 'provision_party_login')
        and exists (
          select 1 from public.custom_roles r2
          join public.organizations o2 on o2.id = r2.organization_id
          where r2.id = custom_role_permissions.role_id and o2.engagement_scope = 'client_managed'
        )
      )
    )
  );

drop policy if exists custom_role_assignments_self_managed_write on public.custom_role_assignments;
create policy custom_role_assignments_self_managed_write on public.custom_role_assignments
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(r.organization_id)
    )
    and (
      custom_role_assignments.project_id is null
      or exists (
        select 1 from public.projects p
        join public.custom_roles r2 on r2.id = custom_role_assignments.role_id
        where p.id = custom_role_assignments.project_id
          and p.organization_id = r2.organization_id
      )
    )
    and exists (
      select 1 from public.custom_roles r3
      where r3.id = custom_role_assignments.role_id
        and public.user_has_org_access(custom_role_assignments.user_id, r3.organization_id)
    )
  );
