-- Phase 0: row-level security for the tenancy tables.
-- Tenant isolation is enforced here, at the database layer, so it holds even if application code
-- has a bug — per the client's architecture doc, this is the single highest-priority requirement.

-- SECURITY DEFINER + explicit search_path: these helper functions are called from inside RLS
-- policies on the very tables they query (access_grants reads itself indirectly via has_org_access
-- when checking organizations), so they must run with elevated privilege and a locked search_path
-- to avoid recursive-policy evaluation and search-path hijacking.

create or replace function public.is_jags_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_jags_staff from public.users where id = auth.uid()), false);
$$;

create or replace function public.has_org_access(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.access_grants
    where user_id = auth.uid()
      and (
        scope_type = 'global'
        or (scope_type = 'organization' and organization_id = target_org_id)
        or (scope_type = 'project' and organization_id = target_org_id)
      )
  );
$$;

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.access_grants enable row level security;
alter table public.master_disciplines enable row level security;

-- organizations: visible to anyone with a grant reaching that org; only JAGS staff can create/edit.
create policy organizations_select on public.organizations
  for select using (public.has_org_access(id));

create policy organizations_staff_write on public.organizations
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

-- users: everyone can see and edit their own profile; JAGS staff can see and manage everyone's
-- (needed to run onboarding, deactivate accounts, etc.).
create policy users_select_self_or_staff on public.users
  for select using (id = auth.uid() or public.is_jags_staff());

create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy users_staff_write on public.users
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

-- access_grants: a user can see their own grants (the frontend needs this to know what nav/data
-- it's allowed to render); only JAGS staff can create or change grants — a user can never grant
-- themselves more access.
create policy access_grants_select_self_or_staff on public.access_grants
  for select using (user_id = auth.uid() or public.is_jags_staff());

create policy access_grants_staff_write on public.access_grants
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

-- master_disciplines: shared reference data, readable by any signed-in user, editable by staff only.
create policy master_disciplines_select on public.master_disciplines
  for select using (auth.role() = 'authenticated');

create policy master_disciplines_staff_write on public.master_disciplines
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());
