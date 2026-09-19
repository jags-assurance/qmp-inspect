-- Fixes a real bug found during live verification of
-- 20260919030000_self_managed_custom_role_management.sql's custom_role_assignments_self_managed_
-- write policy: its "the assigned user must actually have access to this org" check queried
-- public.access_grants directly with a plain join/exists, which is itself RLS-protected by
-- access_grants_select_self_or_staff (20260909210100_phase0_rls_policies.sql) — "a user can see
-- their own access_grants row, or a JAGS staff member can see any row". A self-managed client is
-- neither, so that inline check always evaluated to false for any OTHER user, making it impossible
-- for a client to assign its own role to anyone but itself. This is exactly why has_org_access()
-- exists as a SECURITY DEFINER function instead of being inlined everywhere it's needed — a plain
-- query inside a USING/WITH CHECK clause runs with the caller's own row visibility, not elevated
-- privilege, so it silently under-counts rows the caller can't otherwise SELECT.
--
-- Fix: a new SECURITY DEFINER helper, user_has_org_access(target_user_id, target_org_id) — the same
-- shape as has_org_access(target_org_id), which is hardcoded to auth.uid(), but parameterized so it
-- can check an arbitrary OTHER user (the one being assigned a role), not just the caller.

create or replace function public.user_has_org_access(target_user_id uuid, target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.access_grants
    where user_id = target_user_id
      and (
        scope_type = 'global'
        or (scope_type = 'organization' and organization_id = target_org_id)
        or (scope_type = 'project' and organization_id = target_org_id)
      )
  );
$$;

grant execute on function public.user_has_org_access(uuid, uuid) to authenticated;

drop policy custom_role_assignments_self_managed_write on public.custom_role_assignments;

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
      where r3.id = custom_role_assignments.role_id
        and public.user_has_org_access(custom_role_assignments.user_id, r3.organization_id)
    )
  );
