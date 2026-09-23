-- Performance follow-up on the 2026-09-27 feature batch (R23/R25/R104/R31/R32/R68/R46/R83/R111):
-- every one of those migrations added new FKs and, in five cases, a second permissive SELECT
-- policy alongside an existing "FOR ALL" staff/admin policy — the exact same two categories of
-- debt fixed earlier this session (20260922000000_performance_missing_fk_indexes.sql,
-- 20260922000200/300_consolidate_permissive_policies_tier1/2.sql). Applying the same fixes here.

create index if not exists audit_log_actor_id_idx on public.audit_log (actor_id);
create index if not exists checklist_library_templates_created_by_idx on public.checklist_library_templates (created_by);
create index if not exists cloud_folder_sync_configs_connected_by_idx on public.cloud_folder_sync_configs (connected_by);
create index if not exists itp_approval_workflow_configs_required_approver_user_id_idx on public.itp_approval_workflow_configs (required_approver_user_id);
create index if not exists itp_approval_workflow_configs_required_reviewer_user_id_idx on public.itp_approval_workflow_configs (required_reviewer_user_id);
create index if not exists itp_items_governing_drawing_document_id_idx on public.itp_items (governing_drawing_document_id);
create index if not exists itp_master_revisions_created_by_idx on public.itp_master_revisions (created_by);
create index if not exists itp_revisions_created_by_idx on public.itp_revisions (created_by);
create index if not exists itps_external_approval_recorded_by_idx on public.itps (external_approval_recorded_by);
create index if not exists standalone_assignments_cleared_by_idx on public.standalone_assignments (cleared_by);

-- checklist_library_templates: merge staff_all (FOR ALL) + org_select (FOR SELECT) into one SELECT
-- policy plus three single-command staff-only write policies.
drop policy if exists checklist_library_templates_staff_all on public.checklist_library_templates;
drop policy if exists checklist_library_templates_org_select on public.checklist_library_templates;

create policy checklist_library_templates_select on public.checklist_library_templates
  for select using (is_jags_staff() or organization_id is null or has_org_access(organization_id));
create policy checklist_library_templates_i on public.checklist_library_templates
  for insert with check (is_jags_staff());
create policy checklist_library_templates_u on public.checklist_library_templates
  for update using (is_jags_staff()) with check (is_jags_staff());
create policy checklist_library_templates_d on public.checklist_library_templates
  for delete using (is_jags_staff());

-- checklist_library_items: same shape, org access resolved via the parent template.
drop policy if exists checklist_library_items_staff_all on public.checklist_library_items;
drop policy if exists checklist_library_items_org_select on public.checklist_library_items;

create policy checklist_library_items_select on public.checklist_library_items
  for select using (
    is_jags_staff() or exists (
      select 1 from public.checklist_library_templates t
      where t.id = checklist_library_items.library_template_id
        and (t.organization_id is null or has_org_access(t.organization_id))
    )
  );
create policy checklist_library_items_i on public.checklist_library_items
  for insert with check (is_jags_staff());
create policy checklist_library_items_u on public.checklist_library_items
  for update using (is_jags_staff()) with check (is_jags_staff());
create policy checklist_library_items_d on public.checklist_library_items
  for delete using (is_jags_staff());

-- cloud_folder_sync_configs: admin_write's condition (is_jags_staff() and has_org_access) is a
-- strict subset of select's (has_org_access alone), so the OR-merged select is just has_org_access.
drop policy if exists cloud_folder_sync_configs_admin_write on public.cloud_folder_sync_configs;
drop policy if exists cloud_folder_sync_configs_select on public.cloud_folder_sync_configs;

create policy cloud_folder_sync_configs_select on public.cloud_folder_sync_configs
  for select using (has_org_access(organization_id));
create policy cloud_folder_sync_configs_i on public.cloud_folder_sync_configs
  for insert with check (is_jags_staff() and has_org_access(organization_id));
create policy cloud_folder_sync_configs_u on public.cloud_folder_sync_configs
  for update using (is_jags_staff() and has_org_access(organization_id)) with check (is_jags_staff() and has_org_access(organization_id));
create policy cloud_folder_sync_configs_d on public.cloud_folder_sync_configs
  for delete using (is_jags_staff() and has_org_access(organization_id));

-- itp_approval_workflow_configs: identical shape to cloud_folder_sync_configs above.
drop policy if exists itp_approval_workflow_configs_admin_write on public.itp_approval_workflow_configs;
drop policy if exists itp_approval_workflow_configs_select on public.itp_approval_workflow_configs;

create policy itp_approval_workflow_configs_select on public.itp_approval_workflow_configs
  for select using (has_org_access(organization_id));
create policy itp_approval_workflow_configs_i on public.itp_approval_workflow_configs
  for insert with check (is_jags_staff() and has_org_access(organization_id));
create policy itp_approval_workflow_configs_u on public.itp_approval_workflow_configs
  for update using (is_jags_staff() and has_org_access(organization_id)) with check (is_jags_staff() and has_org_access(organization_id));
create policy itp_approval_workflow_configs_d on public.itp_approval_workflow_configs
  for delete using (is_jags_staff() and has_org_access(organization_id));

-- organization_module_licenses: admin_write uses is_admin_staff() (narrower than is_jags_staff()),
-- with no has_org_access requirement, so OR-merged with select's has_org_access(organization_id).
drop policy if exists organization_module_licenses_admin_write on public.organization_module_licenses;
drop policy if exists organization_module_licenses_select on public.organization_module_licenses;

create policy organization_module_licenses_select on public.organization_module_licenses
  for select using (has_org_access(organization_id) or is_admin_staff());
create policy organization_module_licenses_i on public.organization_module_licenses
  for insert with check (is_admin_staff());
create policy organization_module_licenses_u on public.organization_module_licenses
  for update using (is_admin_staff()) with check (is_admin_staff());
create policy organization_module_licenses_d on public.organization_module_licenses
  for delete using (is_admin_staff());
