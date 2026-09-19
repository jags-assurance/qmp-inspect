-- Closes the other half of the Self-Managed/Platform-Only client gap
-- (20260919010000_self_managed_project_creation.sql let a self_managed client create/edit their own
-- projects; this lets them staff those projects too). Without this, a self_managed client could
-- create a brand-new project and then had no way to add anyone to it — every project_party and
-- every access_grants row still required a JAGS Admin, which defeats "the client runs its own
-- program on the platform" for the one tier whose entire point is exactly that.
--
-- Scope decision, deliberately narrow:
--   * INSERT only, on both project_parties and access_grants — never update/delete. Editing or
--     removing an existing party/grant (project_parties_write's is_jags_staff()/custom-permission
--     branches, access_grants_staff_write) stays JAGS-staff-only (or custom-permission-holder-only),
--     same as today. A self-managed client can onboard new people, not touch existing ones.
--   * No new-account creation is enabled by this migration by itself. access_grants.user_id is a
--     not-null foreign key to public.users(id) (20260909210000_phase0_tenancy_schema.sql), so RLS
--     alone already refuses to insert a grant for an email/user that doesn't exist — the actual
--     "does this email resolve to a real account" check happens at the app layer
--     (addSelfManagedPartyAction, apps/web/lib/projects/actions.ts) before either insert is even
--     attempted, exactly so a bad email fails with a clear message instead of a raw FK violation.
--   * Cross-organisation onboarding is intentionally ALLOWED: the target user_id can belong to any
--     organisation, not just the inserting client's own. A self-managed client onboarding an
--     external contractor/vendor/lab's already-existing platform user (e.g. a subcontractor who
--     already has a login because they work another client's project too) is a plausible, ordinary
--     case — it mirrors how JAGS itself onboards subcontractors onto a project today (any user_id is
--     eligible via addProjectPartyAction/reassignSignoffPartyAction, no same-org restriction there
--     either). The access being granted is strictly scope_type='project', pinned to project_id/
--     organization_id via access_grants_scope_shape, so the grant only ever reaches the ONE project
--     being staffed — never the granting org's other projects, and never the target user's own home
--     org's data. The seat-limit trigger (access_grants_org_seat_limit,
--     20260917070000_org_plans_and_seat_limit.sql) still applies normally on insert.
--   * Restricted to organizations.engagement_scope = 'self_managed' specifically, matching
--     projects_self_managed_client_write's own scoping: a full_service client still goes through
--     JAGS to staff a project, matching that tier's definition.

drop policy if exists project_parties_self_managed_client_insert on public.project_parties;
create policy project_parties_self_managed_client_insert on public.project_parties
  for insert
  with check (
    exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      where p.id = project_parties.project_id
        and o.engagement_scope = 'self_managed'
        and public.has_org_access(o.id)
    )
  );

drop policy if exists access_grants_self_managed_project_insert on public.access_grants;
create policy access_grants_self_managed_project_insert on public.access_grants
  for insert
  with check (
    scope_type = 'project'
    and project_id is not null
    and organization_id is not null
    and exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      where p.id = access_grants.project_id
        and o.id = access_grants.organization_id
        and o.engagement_scope = 'self_managed'
        and public.has_org_access(o.id)
    )
  );
