-- Security hardening found in the project / parties / vault audit.
--
-- 1. vault_documents_update let ANY user with project access write ANY column, including
--    status='approved' / approved_by / approved_at, so a subcontractor, TPI or client could approve a
--    document directly. A trigger now guards the approval fields. Service-role writes (the worker's
--    auto-filing, auth.uid() is null) are unaffected.
create or replace function public.vault_documents_guard_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.status = 'approved' and old.status is distinct from 'approved')
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    select f.project_id into v_project_id from public.vault_folders f where f.id = new.folder_id;
    if not (
      public.is_admin_staff()
      or public.has_custom_permission(auth.uid(), 'approve_vault_document', v_project_id)
      or exists (
        select 1 from public.vault_document_approvers a
        where a.document_id = new.id and a.approver_user_id = auth.uid()
      )
    ) then
      raise exception 'Only a JAGS Admin, a named approver or someone granted the approve permission can approve a vault document'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists vault_documents_guard_approval on public.vault_documents;
create trigger vault_documents_guard_approval
  before update on public.vault_documents
  for each row execute function public.vault_documents_guard_approval();

-- 2. vault_folders_staff_write was FOR ALL on has_org_access: in a self-managed org any member
--    (including a project-scoped contractor) could delete a folder, and folder deletes cascade to
--    documents. Staff keep full write via the tier-1 policies; an organisation's own (org-wide) members
--    may add and rename folders, but never delete them.
drop policy if exists vault_folders_staff_write on public.vault_folders;
create policy vault_folders_org_member_insert on public.vault_folders
  for insert
  with check (
    exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      where p.id = vault_folders.project_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(p.organization_id)
    )
  );
create policy vault_folders_org_member_update on public.vault_folders
  for update
  using (
    exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      where p.id = vault_folders.project_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      where p.id = vault_folders.project_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_wide_access(p.organization_id)
    )
  );

-- 3. Self-managed onboarding (parties, grants) and project writes passed for ANY grant in the org,
--    including project-scoped ones, so a subcontractor on project A could grant itself project B.
--    Only organisation-wide (or global) grants count now.
drop policy if exists access_grants_insert on public.access_grants;
create policy access_grants_insert on public.access_grants
  for insert
  with check (
    public.is_jags_staff()
    or (
      scope_type = 'project' and project_id is not null and organization_id is not null
      and exists (
        select 1 from public.projects p
        join public.organizations o on o.id = p.organization_id
        where p.id = access_grants.project_id and o.id = access_grants.organization_id
          and o.engagement_scope = 'self_managed'
          and public.has_org_wide_access(o.id)
      )
    )
  );

drop policy if exists project_parties_i on public.project_parties;
create policy project_parties_i on public.project_parties
  for insert
  with check (
    exists (select 1 from public.projects p where p.id = project_parties.project_id and public.is_jags_staff() and public.has_org_access(p.organization_id))
    or public.has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or public.has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      where p.id = project_parties.project_id and o.engagement_scope = 'self_managed'
        and public.has_org_wide_access(o.id)
    )
  );

-- 4. Project create/update: inspectors (is_jags_staff) could create projects although the screen is
--    admin-only, and project-scoped users in a self-managed org could create/edit any project there.
drop policy if exists projects_i on public.projects;
create policy projects_i on public.projects
  for insert
  with check (
    (public.is_admin_staff() and public.has_project_access(id, organization_id))
    or (
      exists (select 1 from public.organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed')
      and public.has_org_wide_access(organization_id)
    )
  );

drop policy if exists projects_u on public.projects;
create policy projects_u on public.projects
  for update
  using (
    (public.is_jags_staff() and public.has_project_access(id, organization_id))
    or (
      exists (select 1 from public.organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed')
      and public.has_org_wide_access(organization_id)
    )
  )
  with check (
    (public.is_jags_staff() and public.has_project_access(id, organization_id))
    or (
      exists (select 1 from public.organizations o where o.id = projects.organization_id and o.engagement_scope = 'self_managed')
      and public.has_org_wide_access(organization_id)
    )
  );
