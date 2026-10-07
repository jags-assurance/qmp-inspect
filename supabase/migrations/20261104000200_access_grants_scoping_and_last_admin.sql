-- S1-02 / S1-03 / S1-15: scope access_grants writes properly and protect the last JAGS Admin.
--
-- Why:
--   * 20261006150000 let ANY JAGS staff insert a project-scoped grant for any user on ANY project
--     (no check of the project at all), and update/delete let any staff touch any grant, including an
--     admin's global grant. A scoped inspector could therefore self-grant another client's project.
--   * The client_managed tier's provision_party_login holders were dropped from the insert policy,
--     so provisioning a party login created the Auth account, linked the party and then failed on the
--     grant (S1-03).
--   * Nothing stopped the only active JAGS Admin from being removed, demoted or deactivated.
--
-- What:
--   * Admin: unrestricted (as before).
--   * Other JAGS staff: project-scoped grants only, and only on a project they themselves have access
--     to (and whose organisation matches the row).
--   * Self-managed / client-managed organisation-wide holders: project grants on their own org's
--     projects (client_managed re-added), may also remove those project grants for non-staff users.
--   * Last-admin guard triggers on access_grants and users.
-- Idempotent: safe to re-run.

drop policy if exists access_grants_insert on public.access_grants;
create policy access_grants_insert on public.access_grants for insert
  with check (
    public.is_admin_staff()
    or (
      public.is_jags_staff()
      and scope_type = 'project' and project_id is not null and organization_id is not null
      and exists (
        select 1 from public.projects p
        where p.id = access_grants.project_id
          and p.organization_id = access_grants.organization_id
          and public.has_project_access(p.id, p.organization_id)
      )
    )
    or (
      scope_type = 'project' and project_id is not null and organization_id is not null
      and exists (
        select 1 from public.projects p
        join public.organizations o on o.id = p.organization_id
        where p.id = access_grants.project_id
          and o.id = access_grants.organization_id
          and o.engagement_scope in ('self_managed', 'client_managed')
          and public.has_org_wide_access(o.id)
      )
    )
  );

drop policy if exists access_grants_staff_write_u on public.access_grants;
create policy access_grants_staff_write_u on public.access_grants for update
  using (
    public.is_admin_staff()
    or (public.is_jags_staff() and scope_type = 'project' and project_id is not null and organization_id is not null
        and public.has_project_access(project_id, organization_id))
  )
  with check (
    public.is_admin_staff()
    or (public.is_jags_staff() and scope_type = 'project' and project_id is not null and organization_id is not null
        and public.has_project_access(project_id, organization_id))
  );

drop policy if exists access_grants_staff_write_d on public.access_grants;
create policy access_grants_staff_write_d on public.access_grants for delete
  using (
    public.is_admin_staff()
    or (public.is_jags_staff() and scope_type = 'project' and project_id is not null and organization_id is not null
        and public.has_project_access(project_id, organization_id))
    or (
      -- A self-/client-managed organisation may take its own people off its own projects (the
      -- party deactivate flow), but never touch a JAGS staff member's grant.
      scope_type = 'project' and project_id is not null and organization_id is not null
      and public.has_org_wide_access(organization_id)
      and exists (select 1 from public.organizations o where o.id = access_grants.organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
      and not exists (select 1 from public.users u where u.id = access_grants.user_id and u.is_jags_staff)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Last-admin guards
-- ---------------------------------------------------------------------------------------------
create or replace function public.access_grants_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A cascade (user / organisation deleted) is an intentional teardown, not an admin action.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if old.scope_type = 'global'
     and (tg_op = 'DELETE' or new.scope_type <> 'global' or new.user_id is distinct from old.user_id)
     and exists (
       select 1 from public.users u
       where u.id = old.user_id and u.is_jags_staff and u.is_active and u.staff_role is distinct from 'inspector'
     )
     and not exists (
       select 1 from public.access_grants g
       join public.users u on u.id = g.user_id
       where g.scope_type = 'global' and g.id <> old.id
         and u.is_jags_staff and u.is_active and u.staff_role is distinct from 'inspector'
     ) then
    raise exception 'This is the last global grant held by an active JAGS Admin, so it cannot be removed.' using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists access_grants_protect_last_admin on public.access_grants;
create trigger access_grants_protect_last_admin
  before update or delete on public.access_grants
  for each row execute function public.access_grants_protect_last_admin();

create or replace function public.users_protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.is_jags_staff and old.is_active and old.staff_role is distinct from 'inspector'
     and not (new.is_jags_staff and new.is_active and new.staff_role is distinct from 'inspector')
     and not exists (
       select 1 from public.users u
       join public.access_grants g on g.user_id = u.id and g.scope_type = 'global'
       where u.id <> old.id and u.is_jags_staff and u.is_active and u.staff_role is distinct from 'inspector'
     ) then
    raise exception 'This is the last active JAGS Admin with global access, so the account cannot be demoted or deactivated.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists users_protect_last_admin on public.users;
create trigger users_protect_last_admin
  before update on public.users
  for each row execute function public.users_protect_last_admin();

revoke all on function public.access_grants_protect_last_admin() from public, anon, authenticated;
revoke all on function public.users_protect_last_admin() from public, anon, authenticated;
