-- Closes a real gap: a Self-Managed/Platform-Only client (organizations.engagement_scope =
-- 'self_managed', 20260918010000_self_managed_engagement_scope.sql) could already create/execute
-- their own ITPs, but could not create a new PROJECT to put them under — every project still
-- required a JAGS Admin, which contradicts "the client manages its own projects" for a client tier
-- whose entire point is running its own program on the platform.
--
-- Scoped narrowly: insert + update only (a client can create and edit their own org's projects),
-- never delete — the existing projects_write policy (JAGS-staff-only) remains the only path to
-- delete a project, for any org, self-managed or not. Scoped to engagement_scope = 'self_managed'
-- specifically, not any client — a full_service client still goes through JAGS to get a project
-- created, matching that tier's own definition.

create policy projects_self_managed_client_write on public.projects
  for insert
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope = 'self_managed')
    and public.has_org_access(organization_id)
  );

create policy projects_self_managed_client_update on public.projects
  for update
  using (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope = 'self_managed')
    and public.has_org_access(organization_id)
  )
  with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope = 'self_managed')
    and public.has_org_access(organization_id)
  );
