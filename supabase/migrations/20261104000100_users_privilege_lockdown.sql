-- S1-01 / S1-04 / S1-08: close the self-promotion hole on public.users and make deactivation real.
--
-- Why: users_update (20260922000300_consolidate_permissive_policies_tier2.sql) lets a signed-in user
-- update their own row with no column restriction, so anyone with the anon key + their own session
-- could run `update users set is_jags_staff = true, staff_role = 'admin'` on themselves and then
-- pass is_admin_staff() everywhere. is_active was also self-editable and was never read by any RLS
-- helper, so a "deactivated" account kept full access.
--
-- What:
--   1. BEFORE UPDATE trigger: only a JAGS Admin (or a caller with no end-user JWT, i.e. the service
--      role / SQL editor) may change id, email, is_jags_staff, staff_role, is_active or
--      must_change_password. Everyone else is limited to ordinary profile columns (full_name).
--   2. users insert/delete policies become admin-only (they were any-staff).
--   3. is_jags_staff() / is_admin_staff() / has_org_access() / has_project_access() /
--      has_org_wide_access() stop recognising a deactivated user (is_active = false), and the three
--      access helpers also stop recognising an account that still has to change its temporary
--      password (the proxy enforces this in the app; this makes the database agree, so the JWT
--      cannot be used against the REST API directly while the flag is set).
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------------------------
-- 1. Privileged-column guard
-- ---------------------------------------------------------------------------------------------
create or replace function public.users_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- No end-user JWT (service-role client, SQL editor, auth bootstrap triggers): trusted.
  if auth.uid() is null then
    return new;
  end if;

  -- A JAGS Admin may manage other accounts. (Admin-ness is read from the stored row, never from
  -- the row being written, so an update cannot grant itself the right to make the same update.)
  if public.is_admin_staff() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.is_jags_staff is distinct from old.is_jags_staff
     or new.staff_role is distinct from old.staff_role
     or new.is_active is distinct from old.is_active
     or new.must_change_password is distinct from old.must_change_password then
    raise exception 'Only a JAGS Admin can change account privileges.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists users_guard_privileged_columns on public.users;
create trigger users_guard_privileged_columns
  before update on public.users
  for each row execute function public.users_guard_privileged_columns();

revoke all on function public.users_guard_privileged_columns() from public, anon, authenticated;

-- The older single-column guard is now subsumed (kept in place; harmless).

-- ---------------------------------------------------------------------------------------------
-- 2. Insert / delete on users: Admin only (was: any JAGS staff). Update stays self-or-staff at the
--    row level; the trigger above limits which COLUMNS a non-admin can touch.
-- ---------------------------------------------------------------------------------------------
drop policy if exists users_staff_write_i on public.users;
create policy users_staff_write_i on public.users for insert with check (public.is_admin_staff());
drop policy if exists users_staff_write_d on public.users;
create policy users_staff_write_d on public.users for delete using (public.is_admin_staff());

-- ---------------------------------------------------------------------------------------------
-- 3. Helpers: honour is_active (and a pending forced password change)
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_jags_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((select is_jags_staff and is_active from public.users where id = auth.uid()), false);
$$;

create or replace function public.is_admin_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select is_jags_staff and is_active and staff_role is distinct from 'inspector' from public.users where id = auth.uid()),
    false
  );
$$;

-- True when the caller's account may use the platform at all: active, and not still parked on a
-- temporary password. Service-role / anonymous callers (auth.uid() is null) never reach a grant row
-- below anyway, so returning false for them changes nothing.
create or replace function public.auth_user_is_usable()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce((select is_active and not must_change_password from public.users where id = auth.uid()), false);
$$;

create or replace function public.has_org_access(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select public.auth_user_is_usable() and exists (
    select 1 from public.access_grants
    where user_id = auth.uid()
      and (
        scope_type = 'global'
        or (scope_type = 'organization' and organization_id = target_org_id)
        or (scope_type = 'project' and organization_id = target_org_id)
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
  select public.auth_user_is_usable() and exists (
    select 1 from public.access_grants
    where user_id = auth.uid()
      and (
        scope_type = 'global'
        or (scope_type = 'organization' and organization_id = target_org_id)
        or (scope_type = 'project' and project_id = target_project_id)
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
  select public.auth_user_is_usable() and exists (
    select 1 from public.access_grants
    where user_id = auth.uid()
      and (scope_type = 'global' or (scope_type = 'organization' and organization_id = target_org_id))
  );
$$;

revoke all on function public.auth_user_is_usable() from public, anon;
grant execute on function public.auth_user_is_usable() to authenticated;
grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.has_project_access(uuid, uuid) to authenticated;
grant execute on function public.has_org_wide_access(uuid) to authenticated;
grant execute on function public.is_jags_staff() to authenticated;
grant execute on function public.is_admin_staff() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Organisation engagement settings (S1-12): only an Admin may change name/slug/engagement
--    mode/scope/is_active/ai_consent/logo. Previously any JAGS staff (e.g. a scoped inspector) could
--    change these through the API.
-- ---------------------------------------------------------------------------------------------
create or replace function public.restrict_self_managed_org_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.is_admin_staff() then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.is_active is distinct from old.is_active
      or new.engagement_mode is distinct from old.engagement_mode
      or new.engagement_scope is distinct from old.engagement_scope
      or new.ai_consent is distinct from old.ai_consent
      or new.branding_logo_path is distinct from old.branding_logo_path
    then
      raise exception 'Only a JAGS Admin can change that field.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
