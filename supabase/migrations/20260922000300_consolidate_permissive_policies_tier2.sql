-- Tier 2 of the multiple-permissive-policies fix (see 20260922000200's header for the full
-- background): the 12 tables where more than one policy genuinely targets the SAME command (not
-- just an ALL-policy leaking into SELECT) — e.g. itps had a base itps_write (ALL) plus a narrower
-- itps_client_submit_for_review (UPDATE only, this session's own self-managed-submit feature);
-- custom_roles/custom_role_permissions/custom_role_assignments/numbering_configs each had two
-- separate ALL policies (an admin one and a self-managed-client one).
--
-- Fix: read every affected policy's actual USING/WITH CHECK text (via pg_policies) and hand-merged
-- each command's overlapping conditions with OR into one policy per command — logically identical
-- to what Postgres already computed by evaluating both permissive policies, just as one expression.
-- Verified via a second performance-advisor pass (0 remaining multiple_permissive_policies), a
-- security-advisor pass (no new findings), and a live smoke test (ITP register, project
-- parties, custom roles all render correctly).

-- ===== access_grants =====
drop policy access_grants_staff_write on public.access_grants;
create policy access_grants_staff_write_u on public.access_grants for update using (is_jags_staff()) with check (is_jags_staff());
create policy access_grants_staff_write_d on public.access_grants for delete using (is_jags_staff());

drop policy access_grants_self_managed_project_insert on public.access_grants;
create policy access_grants_insert on public.access_grants
  for insert with check (
    is_jags_staff()
    or (
      scope_type = 'project' and project_id is not null and organization_id is not null
      and exists (
        select 1 from projects p join organizations o on o.id = p.organization_id
        where p.id = access_grants.project_id and o.id = access_grants.organization_id
          and o.engagement_scope = 'self_managed' and has_org_access(o.id)
      )
    )
  );

-- ===== custom_role_assignments =====
drop policy custom_role_assignments_select on public.custom_role_assignments;
create policy custom_role_assignments_select on public.custom_role_assignments
  for select using (
    user_id = (select auth.uid())
    or is_jags_staff()
    or exists (
      select 1 from custom_roles r join organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
    )
  );

drop policy custom_role_assignments_admin_write on public.custom_role_assignments;
drop policy custom_role_assignments_self_managed_write on public.custom_role_assignments;

create policy custom_role_assignments_i on public.custom_role_assignments
  for insert with check (
    is_admin_staff()
    or (
      exists (
        select 1 from custom_roles r join organizations o on o.id = r.organization_id
        where r.id = custom_role_assignments.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
      )
      and (
        project_id is null
        or exists (
          select 1 from projects p join custom_roles r2 on r2.id = custom_role_assignments.role_id
          where p.id = custom_role_assignments.project_id and p.organization_id = r2.organization_id
        )
      )
      and exists (
        select 1 from custom_roles r3
        where r3.id = custom_role_assignments.role_id and user_has_org_access(custom_role_assignments.user_id, r3.organization_id)
      )
    )
  );

create policy custom_role_assignments_u on public.custom_role_assignments
  for update using (
    is_admin_staff()
    or exists (
      select 1 from custom_roles r join organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
    )
  )
  with check (
    is_admin_staff()
    or (
      exists (
        select 1 from custom_roles r join organizations o on o.id = r.organization_id
        where r.id = custom_role_assignments.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
      )
      and (
        project_id is null
        or exists (
          select 1 from projects p join custom_roles r2 on r2.id = custom_role_assignments.role_id
          where p.id = custom_role_assignments.project_id and p.organization_id = r2.organization_id
        )
      )
      and exists (
        select 1 from custom_roles r3
        where r3.id = custom_role_assignments.role_id and user_has_org_access(custom_role_assignments.user_id, r3.organization_id)
      )
    )
  );

create policy custom_role_assignments_d on public.custom_role_assignments
  for delete using (
    is_admin_staff()
    or exists (
      select 1 from custom_roles r join organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
    )
  );

-- ===== custom_role_permissions =====
drop policy custom_role_permissions_select on public.custom_role_permissions;
create policy custom_role_permissions_select on public.custom_role_permissions
  for select using (
    exists (
      select 1 from custom_roles r
      where r.id = custom_role_permissions.role_id
        and ((r.organization_id is null and is_jags_staff()) or (r.organization_id is not null and has_org_access(r.organization_id)))
    )
  );

drop policy custom_role_permissions_admin_write on public.custom_role_permissions;
drop policy custom_role_permissions_self_managed_write on public.custom_role_permissions;

create policy custom_role_permissions_i on public.custom_role_permissions
  for insert with check (
    is_admin_staff()
    or (
      exists (
        select 1 from custom_roles r join organizations o on o.id = r.organization_id
        where r.id = custom_role_permissions.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
      )
      and permission_key = any (array['add_project_party', 'reassign_project_party', 'view_org_reports'])
    )
  );

create policy custom_role_permissions_u on public.custom_role_permissions
  for update using (
    is_admin_staff()
    or exists (
      select 1 from custom_roles r join organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
    )
  )
  with check (
    is_admin_staff()
    or (
      exists (
        select 1 from custom_roles r join organizations o on o.id = r.organization_id
        where r.id = custom_role_permissions.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
      )
      and permission_key = any (array['add_project_party', 'reassign_project_party', 'view_org_reports'])
    )
  );

create policy custom_role_permissions_d on public.custom_role_permissions
  for delete using (
    is_admin_staff()
    or exists (
      select 1 from custom_roles r join organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id and o.engagement_scope = 'self_managed' and has_org_access(r.organization_id)
    )
  );

-- ===== custom_roles =====
drop policy custom_roles_select on public.custom_roles;
create policy custom_roles_select on public.custom_roles
  for select using (
    (organization_id is null and is_jags_staff())
    or (organization_id is not null and has_org_access(organization_id))
  );

drop policy custom_roles_admin_write on public.custom_roles;
drop policy custom_roles_self_managed_write on public.custom_roles;

create policy custom_roles_i on public.custom_roles
  for insert with check (
    is_admin_staff()
    or (
      organization_id is not null
      and exists (select 1 from organizations o where o.id = custom_roles.organization_id and o.engagement_scope = 'self_managed')
      and has_org_access(organization_id)
    )
  );

create policy custom_roles_u on public.custom_roles
  for update using (
    is_admin_staff()
    or (
      organization_id is not null
      and exists (select 1 from organizations o where o.id = custom_roles.organization_id and o.engagement_scope = 'self_managed')
      and has_org_access(organization_id)
    )
  )
  with check (
    is_admin_staff()
    or (
      organization_id is not null
      and exists (select 1 from organizations o where o.id = custom_roles.organization_id and o.engagement_scope = 'self_managed')
      and has_org_access(organization_id)
    )
  );

create policy custom_roles_d on public.custom_roles
  for delete using (
    is_admin_staff()
    or (
      organization_id is not null
      and exists (select 1 from organizations o where o.id = custom_roles.organization_id and o.engagement_scope = 'self_managed')
      and has_org_access(organization_id)
    )
  );

-- ===== numbering_configs =====
drop policy numbering_configs_self_managed_write on public.numbering_configs;
drop policy numbering_configs_write on public.numbering_configs;

create policy numbering_configs_i on public.numbering_configs
  for insert with check (
    (exists (select 1 from organizations o where o.id = numbering_configs.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
    or (is_jags_staff() and has_org_access(organization_id))
  );

create policy numbering_configs_u on public.numbering_configs
  for update using (
    (exists (select 1 from organizations o where o.id = numbering_configs.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
    or (is_jags_staff() and has_org_access(organization_id))
  )
  with check (
    (exists (select 1 from organizations o where o.id = numbering_configs.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
    or (is_jags_staff() and has_org_access(organization_id))
  );

create policy numbering_configs_d on public.numbering_configs
  for delete using (
    (exists (select 1 from organizations o where o.id = numbering_configs.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
    or (is_jags_staff() and has_org_access(organization_id))
  );

-- ===== checklist_items =====
drop policy checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select using (
    exists (
      select 1 from checklist_templates t
      join itp_items it on it.id = t.itp_item_id
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  );

drop policy checklist_items_write on public.checklist_items;
drop policy checklist_items_client_generate on public.checklist_items;

create policy checklist_items_i on public.checklist_items
  for insert with check (
    exists (
      select 1 from checklist_templates t
      join itp_items it on it.id = t.itp_item_id
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status) or is_client_checklist_generator(p.id, i.status))
    )
  );

create policy checklist_items_u on public.checklist_items
  for update using (
    exists (
      select 1 from checklist_templates t
      join itp_items it on it.id = t.itp_item_id
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  )
  with check (
    exists (
      select 1 from checklist_templates t
      join itp_items it on it.id = t.itp_item_id
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  );

create policy checklist_items_d on public.checklist_items
  for delete using (
    exists (
      select 1 from checklist_templates t
      join itp_items it on it.id = t.itp_item_id
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  );

-- ===== checklist_templates =====
drop policy checklist_templates_select on public.checklist_templates;
create policy checklist_templates_select on public.checklist_templates
  for select using (
    exists (
      select 1 from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  );

drop policy checklist_templates_write on public.checklist_templates;
drop policy checklist_templates_client_generate on public.checklist_templates;

create policy checklist_templates_i on public.checklist_templates
  for insert with check (
    exists (
      select 1 from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status) or is_client_checklist_generator(p.id, i.status))
    )
  );

create policy checklist_templates_u on public.checklist_templates
  for update using (
    exists (
      select 1 from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  )
  with check (
    exists (
      select 1 from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  );

create policy checklist_templates_d on public.checklist_templates
  for delete using (
    exists (
      select 1 from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and ((is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))
    )
  );

-- ===== itps =====
drop policy itps_select on public.itps;
create policy itps_select on public.itps
  for select using (
    exists (select 1 from projects p where p.id = itps.project_id and has_project_access(p.id, p.organization_id))
    or exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
  );

drop policy itps_write on public.itps;
drop policy itps_client_submit_for_review on public.itps;

create policy itps_i on public.itps
  for insert with check (
    exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
  );

create policy itps_u on public.itps
  for update using (
    exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
    or (status = 'draft' and is_client_itp_creator(project_id, 'draft'))
  )
  with check (
    exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
    or (status = 'under_review' and is_client_itp_creator(project_id, 'draft'))
  );

create policy itps_d on public.itps
  for delete using (
    exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
  );

-- ===== project_parties =====
drop policy project_parties_select on public.project_parties;
create policy project_parties_select on public.project_parties
  for select using (
    exists (select 1 from projects p where p.id = project_parties.project_id and has_project_access(p.id, p.organization_id))
    or exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
  );

drop policy project_parties_write on public.project_parties;
drop policy project_parties_self_managed_client_insert on public.project_parties;

create policy project_parties_i on public.project_parties
  for insert with check (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or exists (
      select 1 from projects p join organizations o on o.id = p.organization_id
      where p.id = project_parties.project_id and o.engagement_scope = 'self_managed' and has_org_access(o.id)
    )
  );

create policy project_parties_u on public.project_parties
  for update using (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
  )
  with check (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
  );

create policy project_parties_d on public.project_parties
  for delete using (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
  );

-- ===== projects =====
drop policy projects_write on public.projects;
drop policy projects_self_managed_client_write on public.projects;
drop policy projects_self_managed_client_update on public.projects;

create policy projects_i on public.projects
  for insert with check (
    (is_jags_staff() and has_project_access(id, organization_id))
    or (exists (select 1 from organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
  );

create policy projects_u on public.projects
  for update using (
    (is_jags_staff() and has_project_access(id, organization_id))
    or (exists (select 1 from organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
  )
  with check (
    (is_jags_staff() and has_project_access(id, organization_id))
    or (exists (select 1 from organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed') and has_org_access(organization_id))
  );

create policy projects_d on public.projects
  for delete using (is_jags_staff() and has_project_access(id, organization_id));

-- ===== organizations =====
drop policy organizations_self_managed_branding_update on public.organizations;
drop policy organizations_staff_update on public.organizations;
create policy organizations_update on public.organizations
  for update using (
    (engagement_scope = 'self_managed' and has_org_access(id))
    or is_jags_staff()
  )
  with check (
    (engagement_scope = 'self_managed' and has_org_access(id))
    or is_jags_staff()
  );

-- ===== users =====
drop policy users_staff_write on public.users;
create policy users_staff_write_i on public.users for insert with check (is_jags_staff());
create policy users_staff_write_d on public.users for delete using (is_jags_staff());

drop policy users_update_self on public.users;
create policy users_update on public.users
  for update using (id = (select auth.uid()) or is_jags_staff())
  with check (id = (select auth.uid()) or is_jags_staff());
