-- Party login provisioning: previously adding a project party by email only stored the address as
-- plain project_parties.contact_email text — no Supabase Auth account was ever created, so that
-- person had nothing to sign in with (addProjectPartyAction's own comment said as much: "that
-- account has to exist first, via Supabase Auth" — nothing in the app ever created it). This adds
-- the one column the provisioning flow needs: a flag marking an account as still using a
-- JAGS-Admin-set temporary password, so the next sign-in is forced through /reset-password before
-- reaching anywhere else (enforced in proxy.ts) rather than the temporary password being usable
-- indefinitely.
alter table public.users
  add column must_change_password boolean not null default false;

-- users_update (20260922000300_consolidate_permissive_policies_tier2.sql) lets a user update their
-- own row (id = auth.uid()) with no column restriction. Without this guard, a user forced to change
-- their password could bypass that entirely by calling
-- `supabase.from('users').update({must_change_password: false})` directly from the browser (same
-- anon-key + session anyone can drive from devtools) without ever actually changing their password
-- — RLS is this app's real security boundary (see phase0_rls_policies.sql's header comment), so this
-- needs to be closed at the same layer, not just hidden in the UI.
--
-- Only a JAGS Admin/staff session (is_jags_staff()) or the service-role client (auth.uid() is null
-- for it — no end-user JWT `sub` claim) may change this column. The real "I changed my password, so
-- clear the flag" path (lib/auth/actions.ts's updatePasswordAction) therefore does that clear via
-- the service-role client, AFTER Supabase Auth's own auth.updateUser() has already accepted a real
-- new password — never via the user's own ordinary RLS-scoped self-update.
create or replace function public.guard_must_change_password()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.must_change_password is distinct from old.must_change_password
     and auth.uid() is not null
     and not public.is_jags_staff() then
    new.must_change_password := old.must_change_password;
  end if;
  return new;
end;
$$;

create trigger users_guard_must_change_password
  before update on public.users
  for each row execute function public.guard_must_change_password();
