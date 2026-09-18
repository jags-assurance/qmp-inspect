-- Custom action-level RBAC (CEO ask: "custom role-based access control... team roles and
-- responsibilities evolve constantly, so the platform must easily adapt"). Deliberately additive,
-- never a replacement for the existing model: is_jags_staff()/staff_role, party_type, and the teams
-- work all keep working exactly as they do today. A custom role is an EXTRA grantable set of
-- permissions on top of that — a JAGS Admin can hand a specific staff member or a specific client
-- user a named bundle of permissions (e.g. "Project Coordinator" -> add_project_party) without
-- promoting them to full Admin or inventing a new hardcoded role for every variation.
--
-- Scope decision (asked of and confirmed by the CEO): action-level permissions, usable both for
-- JAGS's own staff (organization_id null = a JAGS-global role) and for a specific client
-- organisation's own people (organization_id set = only assignable to/usable within that org).
-- Role/permission MANAGEMENT itself stays JAGS-Admin-only for this round — there is no "client org
-- admin" account type yet to safely delegate that to, so a client can be assigned a custom role a
-- JAGS Admin defines and grants, but can't yet define their own.

create table public.custom_roles (
  id uuid primary key default gen_random_uuid(),
  -- Null = a JAGS-global role, usable by any JAGS staff assignment. Set = scoped to one client
  -- organisation's own people only.
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Same NULL-doesn't-collapse-for-uniqueness issue as document_sequences
-- (20260910020000_phase2_numbering_engine.sql) — two partial unique indexes rather than a sentinel.
create unique index custom_roles_org_name_uidx
  on public.custom_roles (organization_id, name)
  where organization_id is not null;
create unique index custom_roles_global_name_uidx
  on public.custom_roles (name)
  where organization_id is null;

-- Fixed, code-defined permission keys (see lib/rbac/types.ts's PERMISSION_KEYS — the single source
-- of truth this check constraint mirrors) — deliberately not a separate lookup table, since the set
-- of real actions in the app is defined by the codebase, not admin-editable data. Extend both this
-- constraint and PERMISSION_KEYS together when wiring a new action into the permission system.
create table public.custom_role_permissions (
  role_id uuid not null references public.custom_roles (id) on delete cascade,
  permission_key text not null check (permission_key in (
    'add_project_party',
    'reassign_project_party',
    'manage_intervention_levels',
    'issue_irn',
    'close_ncr',
    'view_org_reports'
  )),
  primary key (role_id, permission_key)
);

-- Who holds a role, and where it applies: project_id null = org-wide (or, for a JAGS-global role,
-- platform-wide, mirroring access_grants' own scope_type convention); project_id set = only on that
-- one project, for the same "hybrid, some projects yes some no" flexibility access_grants already
-- has.
create table public.custom_role_assignments (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.custom_roles (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index custom_role_assignments_project_uidx
  on public.custom_role_assignments (role_id, user_id, project_id)
  where project_id is not null;
create unique index custom_role_assignments_global_uidx
  on public.custom_role_assignments (role_id, user_id)
  where project_id is null;

create index custom_role_assignments_user_id_idx on public.custom_role_assignments (user_id);

-- Atomic "does this user hold this permission, in this scope" check — SECURITY DEFINER so it can be
-- used inside RLS policies and app code alike without granting broad table access, same reasoning as
-- has_org_access()/is_jags_staff() (20260909210100_phase0_rls_policies.sql). project_id null means
-- "check org/platform-wide assignments only"; passing a project_id also matches a project-scoped
-- assignment for that specific project.
create or replace function public.has_custom_permission(
  target_user_id uuid,
  target_permission_key text,
  target_project_id uuid default null
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.custom_role_assignments a
    join public.custom_role_permissions p on p.role_id = a.role_id
    where a.user_id = target_user_id
      and p.permission_key = target_permission_key
      and (a.project_id is null or a.project_id = target_project_id)
  );
$$;

alter table public.custom_roles enable row level security;
alter table public.custom_role_permissions enable row level security;
alter table public.custom_role_assignments enable row level security;

-- Select: a JAGS-global role is visible to any JAGS staff; an org-scoped role is visible to anyone
-- with access to that org (so a client can at least see what role they've been given) or JAGS staff
-- managing it.
create policy custom_roles_select on public.custom_roles
  for select using (
    (organization_id is null and public.is_jags_staff())
    or (organization_id is not null and public.has_org_access(organization_id))
  );

create policy custom_role_permissions_select on public.custom_role_permissions
  for select using (
    exists (
      select 1 from public.custom_roles r
      where r.id = custom_role_permissions.role_id
        and (
          (r.organization_id is null and public.is_jags_staff())
          or (r.organization_id is not null and public.has_org_access(r.organization_id))
        )
    )
  );

-- A user can always see their own assignments (so they know what they've been granted); JAGS staff
-- can see every assignment for management purposes.
create policy custom_role_assignments_select on public.custom_role_assignments
  for select using (user_id = auth.uid() or public.is_jags_staff());

-- Management (insert/update/delete on all three tables) is JAGS-Admin-only for this round (using
-- is_admin_staff(), 20260917060000_teams_and_delegation.sql — not just any staff) — see this
-- migration's header comment on why role/permission definition isn't yet delegated to a client-side
-- "org admin" role that doesn't exist.
create policy custom_roles_admin_write on public.custom_roles
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());
create policy custom_role_permissions_admin_write on public.custom_role_permissions
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());
create policy custom_role_assignments_admin_write on public.custom_role_assignments
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());

grant execute on function public.has_custom_permission(uuid, text, uuid) to authenticated;

-- Widen project_parties_write (20260910090000_phase3_scoped_staff_writes.sql) to also allow a
-- non-staff user holding the 'add_project_party' or 'reassign_project_party' custom permission on
-- this project — otherwise the app-layer checks in addProjectPartyAction and
-- reassignSignoffPartyAction (lib/projects/actions.ts, lib/signoff/actions.ts) would pass for a
-- client user granted either permission, only for the RLS write to then silently reject it. Staff
-- behavior is completely unchanged (the original is_jags_staff() branch is untouched, just OR'd with
-- the new ones).
drop policy project_parties_write on public.project_parties;
create policy project_parties_write on public.project_parties
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_parties.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
    or public.has_custom_permission(auth.uid(), 'add_project_party', project_parties.project_id)
    or public.has_custom_permission(auth.uid(), 'reassign_project_party', project_parties.project_id)
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_parties.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
    or public.has_custom_permission(auth.uid(), 'add_project_party', project_parties.project_id)
    or public.has_custom_permission(auth.uid(), 'reassign_project_party', project_parties.project_id)
  );
