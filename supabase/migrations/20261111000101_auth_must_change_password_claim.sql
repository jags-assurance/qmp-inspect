-- D-03: take the second query out of proxy.ts for EVERY account, not just party logins.
--
-- proxy.ts decides the forced first-login password change from `app_metadata.must_change_password`
-- on the auth user it already loaded with getUser(), and only falls back to a `public.users` query
-- (cached for 5 minutes in a signed cookie) when that claim is absent. Only logins provisioned by
-- lib/projects/party-provisioning.ts carried the claim; every other account (staff, the seeded
-- admin, anyone created through the Auth dashboard or handle_new_auth_user) hit the fallback query
-- on its first request and again every 5 minutes.
--
-- This migration (idempotent, additive):
--   1. backfills the claim for every existing auth user that lacks it, copying the value from
--      public.users.must_change_password (false for a user with no profile row yet);
--   2. adds a BEFORE INSERT trigger on auth.users that defaults the claim to false for new accounts
--      when the creator did not set one (a provisioning call that sets it to true is left alone).
--
-- The claim is kept current by the application (lib/auth/actions.ts clears it together with
-- public.users.must_change_password when the user changes their password), and proxy.ts keeps its
-- fallback, so an account this migration somehow missed still behaves exactly as before.

update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('must_change_password', coalesce(p.must_change_password, false))
  from public.users p
 where p.id = u.id
   and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'must_change_password');

-- Auth users with no profile row (should not exist, but never leave them on the slow path).
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('must_change_password', false)
 where not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'must_change_password');

create or replace function public.auth_users_default_must_change_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (coalesce(new.raw_app_meta_data, '{}'::jsonb) ? 'must_change_password') then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('must_change_password', false);
  end if;
  return new;
end;
$$;

revoke all on function public.auth_users_default_must_change_claim() from public, anon, authenticated;

drop trigger if exists auth_users_default_must_change_claim on auth.users;
create trigger auth_users_default_must_change_claim
  before insert on auth.users
  for each row execute function public.auth_users_default_must_change_claim();
