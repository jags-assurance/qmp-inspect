-- Third engagement tier: "Full Client-Managed" (organizations.engagement_scope = 'client_managed').
-- The other two tiers already exist: 'full_service' (JAGS runs everything) and 'self_managed'
-- ("Hybrid" — the client builds/submits/accepts its own ITPs, but a JAGS staff member still has to
-- Approve). client_managed is a strict SUPERSET of self_managed's capabilities, plus the two things
-- that make "zero JAGS staff involvement in day-to-day work" actually true:
--   * approve_itp        — the client's own team can move an ITP under_review -> approved itself
--                          (previously always required is_jags_staff(), on every tier).
--   * provision_party_login — the client's own team can create brand-new platform logins for its
--                          own people (previously always JAGS-Admin-only, via
--                          provisionPartyLoginAction / the service-role auth admin API).
--
-- Both are gated behind the existing custom-role-permission system (custom_role_permissions,
-- 20260918020000_custom_rbac.sql) rather than being unconditionally true for every client_managed
-- org's every user — a JAGS Admin still does the one-time onboarding (creating the org, setting
-- engagement_scope = 'client_managed', and typically granting a first custom role holding both new
-- keys to whoever leads the client's own team), and after that the client's own admin-equivalent
-- role can grant/revoke these 2 keys to its own other people without JAGS (see
-- custom_role_permissions_self_managed_write below, widened here) — matching the round-table's own
-- description: "jags assurance will onboarding one client, then next client can [manage] remaining
-- parties... they accept and approve... no jags staff [involvement]."
--
-- Every OTHER self_managed widening this migration also extends to client_managed (org/team/project/
-- role self-service, branding, numbering) since client_managed is a superset, never a narrower tier.

-- ===== 1. engagement_scope check constraint =====
alter table public.organizations
  drop constraint organizations_engagement_scope_check,
  add constraint organizations_engagement_scope_check
    check (engagement_scope in ('full_service', 'self_managed', 'client_managed'));

-- ===== 2. custom_role_permissions.permission_key check constraint =====
alter table public.custom_role_permissions
  drop constraint custom_role_permissions_permission_key_check,
  add constraint custom_role_permissions_permission_key_check check (permission_key in (
    'add_project_party',
    'reassign_project_party',
    'manage_intervention_levels',
    'issue_irn',
    'close_ncr',
    'view_org_reports',
    'approve_vault_document',
    'approve_itp',
    'provision_party_login'
  ));

-- ===== 3. is_client_itp_creator — self_managed's org-wide override now also matches client_managed
-- (final version from 20260919000000_contractor_itp_creation.sql) =====
create or replace function public.is_client_itp_creator(target_project_id uuid, itp_status text default null)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (itp_status is null or itp_status = 'draft')
    and exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and (p.allow_client_itp_creation or o.engagement_scope in ('self_managed', 'client_managed'))
        and pp.party_type = 'client'
        and pp.is_active
        and pp.user_id = auth.uid()
    );
$$;

-- ===== 4. is_client_checklist_generator (20260921000000_self_managed_submit_and_checklist_gen.sql) =====
create or replace function public.is_client_checklist_generator(target_project_id uuid, itp_status text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    itp_status in ('draft', 'approved')
    and exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and pp.is_active
        and pp.user_id = auth.uid()
        and (
          (pp.party_type = 'client' and (p.allow_client_itp_creation or o.engagement_scope in ('self_managed', 'client_managed')))
          or (pp.party_type in ('subcontractor', 'main_contractor') and p.allow_contractor_itp_creation)
        )
    );
$$;

-- ===== 5/6. client_teams bootstrap (20260919020000_client_teams.sql, 20260919021000_..._fix.sql) =====
create or replace function public.can_bootstrap_client_team(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.has_org_access(target_org_id)
    and exists (
      select 1 from public.organizations o
      where o.id = target_org_id and o.engagement_scope in ('self_managed', 'client_managed')
    )
    and not exists (
      select 1 from public.client_teams ct where ct.organization_id = target_org_id
    );
$$;

create or replace function public.can_bootstrap_client_team_members(target_client_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.client_teams ct
      join public.organizations o on o.id = ct.organization_id
      where ct.id = target_client_team_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(ct.organization_id)
    )
    and not exists (
      select 1 from public.client_team_members ctm
      where ctm.client_team_id = target_client_team_id and ctm.is_team_lead = true
    );
$$;

-- ===== 7. custom_roles / custom_role_permissions / custom_role_assignments self-managed write
-- (20260919030000_self_managed_custom_role_management.sql) — org check widened to also match
-- client_managed; custom_role_permissions' WITH CHECK additionally allows the 2
-- CLIENT_MANAGED_ONLY_PERMISSION_KEYS (approve_itp, provision_party_login) ONLY when the role's org
-- is specifically client_managed — a plain self_managed ("Hybrid") org still cannot grant itself
-- either key, keeping Hybrid's "JAGS must approve" behaviour completely unchanged. =====
drop policy custom_roles_self_managed_write on public.custom_roles;
create policy custom_roles_self_managed_write on public.custom_roles
  for all
  using (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.id = custom_roles.organization_id and o.engagement_scope in ('self_managed', 'client_managed')
    )
    and public.has_org_access(organization_id)
  )
  with check (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.id = custom_roles.organization_id and o.engagement_scope in ('self_managed', 'client_managed')
    )
    and public.has_org_access(organization_id)
  );

drop policy custom_role_permissions_self_managed_write on public.custom_role_permissions;
create policy custom_role_permissions_self_managed_write on public.custom_role_permissions
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(r.organization_id)
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

drop policy custom_role_assignments_self_managed_write on public.custom_role_assignments;
create policy custom_role_assignments_self_managed_write on public.custom_role_assignments
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id
        and o.engagement_scope in ('self_managed', 'client_managed')
        and public.has_org_access(r.organization_id)
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

-- ===== 8. itps_u — approve_itp custom-permission holder can move under_review -> approved
-- (20260922000300_consolidate_permissive_policies_tier2.sql is the base being widened) =====
drop policy itps_u on public.itps;
create policy itps_u on public.itps
  for update using (
    exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
    or (status = 'draft' and is_client_itp_creator(project_id, 'draft'))
    or (status = 'under_review' and has_custom_permission(auth.uid(), 'approve_itp', project_id))
  )
  with check (
    exists (select 1 from projects p where p.id = itps.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or is_client_itp_creator(project_id, status)
    or (status = 'under_review' and is_client_itp_creator(project_id, 'draft'))
    or (status = 'approved' and has_custom_permission(auth.uid(), 'approve_itp', project_id))
  );

-- ===== 9. project_parties — self_managed party-onboarding insert widened to client_managed; update
-- also allows a provision_party_login holder to link a newly-created login (user_id) =====
drop policy project_parties_i on public.project_parties;
create policy project_parties_i on public.project_parties
  for insert with check (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or exists (
      select 1 from projects p join organizations o on o.id = p.organization_id
      where p.id = project_parties.project_id and o.engagement_scope in ('self_managed', 'client_managed') and has_org_access(o.id)
    )
  );

drop policy project_parties_u on public.project_parties;
create policy project_parties_u on public.project_parties
  for update using (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'provision_party_login', project_id)
  )
  with check (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'provision_party_login', project_id)
  );

-- ===== 10. access_grants insert — widened to client_managed so a provision_party_login holder's
-- grant (project_parties.ts's provisionPartyLoginAction) actually succeeds =====
drop policy access_grants_insert on public.access_grants;
create policy access_grants_insert on public.access_grants
  for insert with check (
    is_jags_staff()
    or (
      scope_type = 'project' and project_id is not null and organization_id is not null
      and exists (
        select 1 from projects p join organizations o on o.id = p.organization_id
        where p.id = access_grants.project_id and o.id = access_grants.organization_id
          and o.engagement_scope in ('self_managed', 'client_managed') and has_org_access(o.id)
      )
    )
  );

-- ===== 11. projects self-managed write/update — widened to client_managed =====
drop policy projects_self_managed_client_write on public.projects;
drop policy projects_self_managed_client_update on public.projects;
create policy projects_self_managed_client_write on public.projects
  for insert
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_access(organization_id)
  );
create policy projects_self_managed_client_update on public.projects
  for update
  using (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_access(organization_id)
  )
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_access(organization_id)
  );

-- ===== 12. numbering/branding self-managed write — widened to client_managed =====
drop policy numbering_configs_self_managed_write on public.numbering_configs;
create policy numbering_configs_self_managed_write on public.numbering_configs
  for all
  using (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_access(organization_id)
  )
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
    and public.has_org_access(organization_id)
  );

drop policy organizations_self_managed_branding_update on public.organizations;
create policy organizations_self_managed_branding_update on public.organizations
  for update
  using (engagement_scope in ('self_managed', 'client_managed') and public.has_org_access(id))
  with check (engagement_scope in ('self_managed', 'client_managed') and public.has_org_access(id));

drop policy org_branding_insert on storage.objects;
create policy org_branding_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (public.is_jags_staff() or (o.engagement_scope in ('self_managed', 'client_managed') and public.has_org_access(o.id)))
    )
  );

drop policy org_branding_update on storage.objects;
create policy org_branding_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-branding'
    and exists (
      select 1 from public.organizations o
      where o.id::text = (storage.foldername(name))[1]
        and (public.is_jags_staff() or (o.engagement_scope in ('self_managed', 'client_managed') and public.has_org_access(o.id)))
    )
  );
