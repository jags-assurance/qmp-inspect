-- Delegates custom-role DEFINITION (not just assignment) to a Self-Managed client, closing the gap
-- 20260918020000_custom_rbac.sql's header comment explicitly deferred: "Role/permission MANAGEMENT
-- itself stays JAGS-Admin-only for this round — there is no client org admin account type yet to
-- safely delegate that to." That account type now effectively exists: organizations.engagement_scope
-- = 'self_managed' (20260918010000_self_managed_engagement_scope.sql) already lets a client run its
-- own ITPs and its own projects (20260919010000_self_managed_project_creation.sql) without JAGS. A
-- newly-written platform description names "configure and manage its own... roles, permissions" as
-- something a client should be able to do, so this is now in scope.
--
-- What stays JAGS-Admin-only, unchanged:
--   * A JAGS-global role (organization_id is null) — a self-managed client can never create, edit,
--     touch permissions on, or assign a JAGS-global role. Every new policy below hard-requires
--     organization_id is not null AND that organization_id resolves to the caller's own
--     engagement_scope = 'self_managed' org (has_org_access(organization_id)).
--   * Any OTHER organisation's roles — has_org_access() is the same function every other
--     self-managed widening (projects, ITPs) already relies on; it only matches grants scoped to
--     that exact org (or a global JAGS grant), never a different client's org.
--   * The custom_roles_admin_write / custom_role_permissions_admin_write /
--     custom_role_assignments_admin_write policies from 20260918020000_custom_rbac.sql are left
--     completely untouched — a JAGS Admin's reach is unchanged; the policies below are purely
--     additive OR-branches, same pattern as projects_self_managed_client_write.
--
-- Judgment call (the important one): custom_role_permissions.permission_key is fixed to 6 real
-- action keys (see that check constraint). Not all 6 are safe for a client to grant to ITS OWN
-- role, even scoped to its own org, even though a JAGS Admin can grant any of them today:
--
--   Safe for client self-service (client-operational — the client is deciding how ITS OWN people
--   split up work on ITS OWN projects, no different in kind from it already creating those
--   projects/ITPs itself):
--     - add_project_party        (already app-wired: lib/projects/actions.ts's addProjectPartyAction)
--     - reassign_project_party   (already app-wired: lib/signoff/actions.ts's reassignSignoffPartyAction)
--     - view_org_reports         (pure visibility into the client's own org's reports — not yet
--                                  app-wired to any gate, but inherently no more sensitive than
--                                  reports the client can already reach via its own org access)
--
--   Kept JAGS-Admin-grantable-only, even for a self-managed org's own role (assurance-integrity
--   concerns, not app-wiring gaps — none of these 3 are app-wired to hasPermission() yet either, so
--   this is a forward-looking restriction, not a workaround for an existing gate):
--     - manage_intervention_levels — lets the holder redefine which sign-off levels BLOCK progress
--       (is_blocking) org-wide (20260917090000_configurable_intervention_levels.sql). That's a QA
--       policy control over the org's whole assurance structure, not a day-to-day project task — a
--       client silently loosening its own "Hold" definitions would undermine the independent-
--       assurance premise of the platform. Stays admin-grantable-only, self-managed or not.
--     - issue_irn — an Inspection Release Notice is the formal release/certification artifact for a
--       passed inspection. Letting a client grant itself the ability to issue its own release notices
--       is a self-certification concern (grading your own homework), which cuts against the whole
--       point of an independent assurance platform. Stays admin-grantable-only.
--     - close_ncr — closing out a non-conformance the client's own org raised is the same
--       self-certification concern as issue_irn: verification-of-effectiveness sign-off is meant to
--       be an independently-controlled gate, not something a client can hand itself. Stays
--       admin-grantable-only.
--
--   This means custom_role_permissions needs its OWN check (see custom_role_permissions_self_managed_
--   write below) restricting which permission_keys a self-managed client can ATTACH to its own role,
--   on top of the org-scoping check — a full JAGS Admin is unaffected and can still attach any of the
--   6 to any role via the untouched admin_write policy.

-- custom_roles: a self-managed client can create/rename/delete a role scoped to its OWN
-- organization_id only. organization_id is not null is required in both using and with check —
-- never optional/omittable the way it is in the admin create form, since a client leaving it blank
-- must never be able to produce (or repoint an existing row to) a JAGS-global role.
create policy custom_roles_self_managed_write on public.custom_roles
  for all
  using (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.id = custom_roles.organization_id and o.engagement_scope = 'self_managed'
    )
    and public.has_org_access(organization_id)
  )
  with check (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.id = custom_roles.organization_id and o.engagement_scope = 'self_managed'
    )
    and public.has_org_access(organization_id)
  );

-- custom_role_permissions: org-scoping in both using/with check (mirrors custom_roles above, via a
-- join since this table has no organization_id of its own); the permission_key allow-list is
-- WITH-CHECK-ONLY, deliberately. WITH CHECK governs INSERT and the new row on UPDATE, so it blocks a
-- client from ATTACHING one of the 3 admin-only keys to its own role. USING has no permission_key
-- restriction, so it governs SELECT/UPDATE's old-row check and DELETE unrestricted by key — a client
-- can still remove ANY permission (including an admin-only one a JAGS Admin previously granted) from
-- its own role; revoking is never the sensitive direction, only granting is.
create policy custom_role_permissions_self_managed_write on public.custom_role_permissions
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope = 'self_managed'
        and public.has_org_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_permissions.role_id
        and o.engagement_scope = 'self_managed'
        and public.has_org_access(r.organization_id)
    )
    and custom_role_permissions.permission_key in ('add_project_party', 'reassign_project_party', 'view_org_reports')
  );

-- custom_role_assignments: WHO HOLDS a role stays more conservatively gated than the role
-- definition itself, per the same principle access_grants/project_parties already follow — but a
-- self-managed client assigning its OWN role (one it defined, scoped to its own org) to its OWN
-- org's users is symmetric to point 1 above and safe to widen the same way. Two extra checks beyond
-- the org-scoping, both easy to miss and both enforced in with check:
--   1. If project_id is set, that project must belong to the SAME organization_id as the role —
--      otherwise a client could scope its own role's assignment onto a project it has no business
--      touching just because the project_id column has no direct org check of its own.
--   2. The user being assigned must themselves have an access grant into that same organization —
--      otherwise a client could hand its custom permissions to an arbitrary user_id (e.g. a JAGS
--      staff member or a different client's user) who has nothing to do with this org.
create policy custom_role_assignments_self_managed_write on public.custom_role_assignments
  for all
  using (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id
        and o.engagement_scope = 'self_managed'
        and public.has_org_access(r.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.custom_roles r
      join public.organizations o on o.id = r.organization_id
      where r.id = custom_role_assignments.role_id
        and o.engagement_scope = 'self_managed'
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
      join public.access_grants ag on ag.organization_id = r3.organization_id
      where r3.id = custom_role_assignments.role_id
        and ag.user_id = custom_role_assignments.user_id
    )
  );
