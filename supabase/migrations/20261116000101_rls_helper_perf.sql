-- Performance: make the RLS helper functions cheaper per evaluated row. No behaviour change.
--
-- Why: has_org_access / has_project_access / has_org_wide_access are called once PER ROW by the
-- policies on almost every table. Each call used to be: a SECURITY DEFINER function (never inlined,
-- pays a search_path save/restore) -> which called auth_user_is_usable() (a SECOND SECURITY DEFINER
-- call, with its own public.users lookup) -> and then ran the access_grants query. Scanning a few
-- hundred rows (an NCR register, an admin dashboard) therefore made ~3 function invocations and 2
-- sub-queries per row, which is what saturates a small shared database.
--
-- What:
--   1. The three access helpers do the "active and not on a temporary password" check as a JOIN to
--      public.users inside the SAME statement as the grant lookup: one function invocation, one
--      statement, no nested definer call. Semantics are identical: a missing user row, is_active
--      false/null or must_change_password true/null all yield false (before: coalesce(..., false)).
--   2. auth.uid() is wrapped as (select auth.uid()) inside every helper so it is evaluated once per
--      call as an initplan rather than re-evaluated for each grant row.
--   3. is_jags_staff() / is_admin_staff() / auth_user_is_usable() get the same auth.uid() wrapping
--      (bodies otherwise unchanged; they stay stable + security definer + the same search_path).
--   4. A plain access_grants(user_id) index so the OR over scope shapes in the helpers can use a
--      single index (the existing ones are partial, one per scope_type).
--   5. A partial expression index on background_jobs for the per-data-book PDF lookups (the Handover page
--      and the Data Book pages filter `payload->>'data_book_id'`, which had no index and so scanned the
--      whole job queue on every view).
--
-- Signatures, volatility, search_path and grants are unchanged (create or replace keeps existing
-- privileges; the grants are restated for safety). The policies themselves are NOT rewritten.
-- Idempotent: safe to re-run.

create index if not exists access_grants_user_id_idx on public.access_grants (user_id);

create index if not exists background_jobs_data_book_idx
  on public.background_jobs ((payload->>'data_book_id'), created_at desc)
  where job_type = 'render_data_book_pdf';

create or replace function public.is_jags_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((select is_jags_staff and is_active from public.users where id = (select auth.uid())), false);
$$;

create or replace function public.is_admin_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select is_jags_staff and is_active and staff_role is distinct from 'inspector' from public.users where id = (select auth.uid())),
    false
  );
$$;

create or replace function public.auth_user_is_usable()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((select is_active and not must_change_password from public.users where id = (select auth.uid())), false);
$$;

create or replace function public.has_org_access(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    join public.access_grants g on g.user_id = u.id
    where u.id = (select auth.uid())
      and u.is_active
      and not u.must_change_password
      and (
        g.scope_type = 'global'
        or (g.scope_type = 'organization' and g.organization_id = target_org_id)
        or (g.scope_type = 'project' and g.organization_id = target_org_id)
      )
  );
$$;

create or replace function public.has_project_access(target_project_id uuid, target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    join public.access_grants g on g.user_id = u.id
    where u.id = (select auth.uid())
      and u.is_active
      and not u.must_change_password
      and (
        g.scope_type = 'global'
        or (g.scope_type = 'organization' and g.organization_id = target_org_id)
        or (g.scope_type = 'project' and g.project_id = target_project_id)
      )
  );
$$;

create or replace function public.has_org_wide_access(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    join public.access_grants g on g.user_id = u.id
    where u.id = (select auth.uid())
      and u.is_active
      and not u.must_change_password
      and (g.scope_type = 'global' or (g.scope_type = 'organization' and g.organization_id = target_org_id))
  );
$$;

revoke all on function public.auth_user_is_usable() from public, anon;
grant execute on function public.auth_user_is_usable() to authenticated;
grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.has_project_access(uuid, uuid) to authenticated;
grant execute on function public.has_org_wide_access(uuid) to authenticated;
grant execute on function public.is_jags_staff() to authenticated;
grant execute on function public.is_admin_staff() to authenticated;
