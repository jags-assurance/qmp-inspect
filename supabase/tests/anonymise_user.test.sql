-- Test for 20261129000100_anonymise_user.sql against STUB tables. Run it on a throwaway database:
--
--   createdb t_anon && psql -v ON_ERROR_STOP=1 -d t_anon -f supabase/tests/anonymise_user.test.sql
--
-- (From the repo root; it \i's the migration.) Every check raises an exception on failure, so a clean
-- run that ends with "anonymise_user: all checks passed" means everything held. Not part of CI: it
-- needs a Postgres, and the stubs only model the columns the function touches.
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;
-- auth.uid() reads a session setting so each check can "sign in" as a different user.
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

drop table if exists public.audit_log, public.access_grants, public.project_party_members, public.project_parties,
  public.document_transmittals, public.inspection_records, public.users cascade;

create table public.users (
  id uuid primary key, email text not null, full_name text not null,
  is_jags_staff boolean not null default false, is_active boolean not null default true,
  staff_role text, must_change_password boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.access_grants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users (id),
  scope_type text not null, organization_id uuid, project_id uuid, role text
);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(), organization_id uuid, project_id uuid,
  entity_type text not null, entity_id uuid not null, action text not null, actor_id uuid references public.users (id),
  summary text not null, changes jsonb, created_at timestamptz not null default now()
);
create table public.project_party_members (
  id uuid primary key default gen_random_uuid(), user_id uuid references public.users (id), invited_email text,
  check (user_id is not null or invited_email is not null)
);
create table public.project_parties (id uuid primary key default gen_random_uuid(), contact_name text, contact_email text);
create table public.document_transmittals (id uuid primary key default gen_random_uuid(), recipient_email text not null);
create table public.inspection_records (
  id uuid primary key default gen_random_uuid(), signed_by_user_id uuid references public.users (id), signed_by_name text
);
-- public.handover_certificates is deliberately absent: the function must skip a missing table.

create function public.is_admin_staff() returns boolean language sql stable security definer as $$
  select coalesce((select is_jags_staff and is_active and staff_role is distinct from 'inspector' from public.users where id = auth.uid()), false)
$$;

-- Stand-in for users_protect_last_admin (20261104000200): same rule, so a bug in the function's own check
-- would still be caught by the database.
create function public.users_protect_last_admin() returns trigger language plpgsql as $$
begin
  if old.is_jags_staff and old.is_active and old.staff_role is distinct from 'inspector'
     and not (new.is_jags_staff and new.is_active and new.staff_role is distinct from 'inspector')
     and not exists (select 1 from public.users u join public.access_grants g on g.user_id = u.id and g.scope_type = 'global'
                     where u.id <> old.id and u.is_jags_staff and u.is_active and u.staff_role is distinct from 'inspector') then
    raise exception 'This is the last active JAGS Admin with global access' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger users_protect_last_admin before update on public.users for each row execute function public.users_protect_last_admin();

\i supabase/migrations/20261129000100_anonymise_user.sql

-- Fixtures: two admins (a1 signs in, a2 is the other admin), an inspector, an external user.
insert into public.users (id, email, full_name, is_jags_staff, staff_role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@jags.test', 'Admin One', true, 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@jags.test', 'Admin Two', true, 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'insp@jags.test', 'Ines Inspector', true, 'inspector'),
  ('00000000-0000-0000-0000-0000000000c1', 'client@x.test', 'Carla Client', false, null);
insert into public.access_grants (user_id, scope_type, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'global', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'global', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'global', 'inspector');
insert into public.project_party_members (user_id, invited_email) values
  ('00000000-0000-0000-0000-0000000000c1', null),
  (null, 'CLIENT@x.test'),
  (null, 'someone.else@x.test');
insert into public.project_parties (contact_name, contact_email) values ('Carla Client', 'client@x.test'), ('Other', 'other@x.test');
insert into public.document_transmittals (recipient_email) values ('client@x.test'), ('other@x.test');
insert into public.inspection_records (signed_by_user_id, signed_by_name) values
  ('00000000-0000-0000-0000-0000000000c1', 'Carla Client'), ('00000000-0000-0000-0000-0000000000b1', 'Ines Inspector');

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected an error like % but the call succeeded: %', p_like, p_sql;
exception when others then
  if sqlerrm like '%expected an error like%' then raise; end if;
  if sqlerrm not like p_like then raise exception 'wrong error for %: got "%", wanted like "%"', p_sql, sqlerrm, p_like; end if;
end $$;

-- 1. Not an admin: refused (inspector, external user, no session).
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000c1', 'subject access request 17')$$, '%Only a JAGS Admin%');
set test.uid = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000c1', 'subject access request 17')$$, '%Only a JAGS Admin%');
set test.uid = '';
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000c1', 'subject access request 17')$$, '%Only a JAGS Admin%');

-- 2. Admin: reason too short, own account, unknown user.
set test.uid = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000c1', 'short')$$, '%at least 10 characters%');
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000a1', 'subject access request 17')$$, '%own account%');
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000ff', 'subject access request 17')$$, '%No such account%');

-- 3. Happy path.
do $$
declare r jsonb;
begin
  r := public.anonymise_user('00000000-0000-0000-0000-0000000000c1', 'subject access request 17');
  if r ->> 'status' <> 'anonymised' then raise exception 'status: %', r; end if;
  if (select email from public.users where id = '00000000-0000-0000-0000-0000000000c1') <> 'anonymised-00000000-0000-0000-0000-0000000000c1@anonymised.invalid' then raise exception 'email not replaced'; end if;
  if (select full_name from public.users where id = '00000000-0000-0000-0000-0000000000c1') <> 'Former user' then raise exception 'name not replaced'; end if;
  if (select is_active from public.users where id = '00000000-0000-0000-0000-0000000000c1') then raise exception 'still active'; end if;
  -- Rows kept, only matching identifiers replaced.
  if (select count(*) from public.project_party_members) <> 3 then raise exception 'party member rows lost'; end if;
  if exists (select 1 from public.project_party_members where lower(invited_email) = 'client@x.test') then raise exception 'invited email kept'; end if;
  if (select invited_email from public.project_party_members where invited_email like 'someone%') is null then raise exception 'unrelated invite changed'; end if;
  if (select contact_email from public.project_parties where contact_name = 'Other') <> 'other@x.test' then raise exception 'unrelated party contact changed'; end if;
  if exists (select 1 from public.project_parties where contact_email = 'client@x.test' or contact_name = 'Carla Client') then raise exception 'party contact kept'; end if;
  if exists (select 1 from public.document_transmittals where recipient_email = 'client@x.test') then raise exception 'transmittal recipient kept'; end if;
  if (select signed_by_name from public.inspection_records where signed_by_user_id = '00000000-0000-0000-0000-0000000000c1') <> 'Former user' then raise exception 'signed-by name kept'; end if;
  if (select signed_by_name from public.inspection_records where signed_by_user_id = '00000000-0000-0000-0000-0000000000b1') <> 'Ines Inspector' then raise exception 'other signer changed'; end if;
  if (select count(*) from public.users) <> 4 then raise exception 'user rows lost'; end if;
  -- Exactly one audit event, by the admin, without the old identifiers.
  if (select count(*) from public.audit_log where action = 'anonymised' and entity_id = '00000000-0000-0000-0000-0000000000c1') <> 1 then raise exception 'audit event missing'; end if;
  if (select actor_id from public.audit_log where action = 'anonymised') <> '00000000-0000-0000-0000-0000000000a1' then raise exception 'wrong actor'; end if;
  if (select (changes::text ~* 'client@x.test|Carla') from public.audit_log where action = 'anonymised') then raise exception 'audit event leaks the old identifiers'; end if;
  -- The absent table was skipped, not fatal.
  if not (r -> 'skipped')::text like '%handover_certificates%' then raise exception 'missing table not reported: %', r; end if;
end $$;

-- 4. Idempotent: a second call changes nothing and writes no second audit event.
do $$
declare r jsonb; v_before timestamptz;
begin
  select updated_at into v_before from public.users where id = '00000000-0000-0000-0000-0000000000c1';
  r := public.anonymise_user('00000000-0000-0000-0000-0000000000c1', 'subject access request 17 again');
  if r ->> 'status' <> 'already_anonymised' then raise exception 'second call: %', r; end if;
  if (select updated_at from public.users where id = '00000000-0000-0000-0000-0000000000c1') <> v_before then raise exception 'second call modified the row'; end if;
  if (select count(*) from public.audit_log where action = 'anonymised') <> 1 then raise exception 'second audit event written'; end if;
end $$;

-- 5. Last active admin: a2 is the only other admin. a1 may anonymise a2 only while a1 stays admin (still
--    another admin with a global grant remains: a1 itself) - so remove that by demoting a1's grant and
--    signing in as an admin who is the sole admin: use a2 as caller against a1 after a2 is the last other.
--    Simplest faithful case: caller a2 anonymises a1 (allowed, a2 remains) ...
set test.uid = '00000000-0000-0000-0000-0000000000a2';
do $$
begin
  perform public.anonymise_user('00000000-0000-0000-0000-0000000000a1', 'former administrator left the company');
  if (select is_active from public.users where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'admin a1 still active'; end if;
end $$;
-- ... then a2 is the last active admin and cannot be anonymised by anyone (an inspector is refused as non-admin,
-- and a2 itself is refused as "own account"). Prove the last-admin branch directly: make a second admin account
-- whose global grant is missing, so the only grant-holding admin left is the target.
insert into public.users (id, email, full_name, is_jags_staff, staff_role) values ('00000000-0000-0000-0000-0000000000a3', 'admin3@jags.test', 'Admin Three', true, 'admin');
set test.uid = '00000000-0000-0000-0000-0000000000a3';
select pg_temp.expect_error($$select public.anonymise_user('00000000-0000-0000-0000-0000000000a2', 'attempt to remove the last admin')$$, '%last active JAGS Admin%');
do $$ begin
  if not (select is_active from public.users where id = '00000000-0000-0000-0000-0000000000a2') then raise exception 'last admin was deactivated'; end if;
  if (select email from public.users where id = '00000000-0000-0000-0000-0000000000a2') <> 'admin2@jags.test' then raise exception 'last admin email changed'; end if;
end $$;

select 'anonymise_user: all checks passed' as result;
