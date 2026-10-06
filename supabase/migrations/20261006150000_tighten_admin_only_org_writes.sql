-- Admin-only at the app layer, so make the database agree: inspectors/team leads could previously write
-- these through the API (found in the organisation pages audit).
drop policy if exists organization_plans_staff_write_d on public.organization_plans;
drop policy if exists organization_plans_staff_write_i on public.organization_plans;
drop policy if exists organization_plans_staff_write_u on public.organization_plans;
create policy organization_plans_staff_write_d on public.organization_plans for delete using (public.is_admin_staff());
create policy organization_plans_staff_write_i on public.organization_plans for insert with check (public.is_admin_staff());
create policy organization_plans_staff_write_u on public.organization_plans for update using (public.is_admin_staff()) with check (public.is_admin_staff());

drop policy if exists automation_rules_write on public.automation_rules;
create policy automation_rules_write on public.automation_rules for all
  using (public.is_admin_staff() and public.has_org_access(organization_id))
  with check (public.is_admin_staff() and public.has_org_access(organization_id));

drop policy if exists cloud_folder_sync_configs_d on public.cloud_folder_sync_configs;
drop policy if exists cloud_folder_sync_configs_i on public.cloud_folder_sync_configs;
drop policy if exists cloud_folder_sync_configs_u on public.cloud_folder_sync_configs;
create policy cloud_folder_sync_configs_d on public.cloud_folder_sync_configs for delete using (public.is_admin_staff() and public.has_org_access(organization_id));
create policy cloud_folder_sync_configs_i on public.cloud_folder_sync_configs for insert with check (public.is_admin_staff() and public.has_org_access(organization_id));
create policy cloud_folder_sync_configs_u on public.cloud_folder_sync_configs for update
  using (public.is_admin_staff() and public.has_org_access(organization_id))
  with check (public.is_admin_staff() and public.has_org_access(organization_id));

drop policy if exists organizations_staff_insert on public.organizations;
create policy organizations_staff_insert on public.organizations for insert with check (public.is_admin_staff());

-- Non-admin staff (inspectors, team leads) may still manage PROJECT-scoped grants, but can no longer
-- create or rescope organisation-wide or global grants.
drop policy if exists access_grants_insert on public.access_grants;
create policy access_grants_insert on public.access_grants for insert
  with check (
    public.is_admin_staff()
    or (public.is_jags_staff() and scope_type = 'project')
    or (scope_type = 'project' and project_id is not null and organization_id is not null
      and exists (select 1 from public.projects p join public.organizations o on o.id = p.organization_id
        where p.id = access_grants.project_id and o.id = access_grants.organization_id and o.engagement_scope = 'self_managed' and public.has_org_wide_access(o.id)))
  );
drop policy if exists access_grants_staff_write_u on public.access_grants;
create policy access_grants_staff_write_u on public.access_grants for update
  using (public.is_admin_staff() or (public.is_jags_staff() and scope_type = 'project'))
  with check (public.is_admin_staff() or (public.is_jags_staff() and scope_type = 'project'));
