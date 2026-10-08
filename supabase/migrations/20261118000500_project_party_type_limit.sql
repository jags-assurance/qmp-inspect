-- Database-level cap on ACTIVE parties per type on one project (S1-13). The same numbers live in
-- apps/web/lib/projects/party-limits.ts (PARTY_TYPE_LIMITS); a unit test keeps the two in step.
-- Until now only the add-party server actions checked it, so a direct API insert bypassed the cap.
--
-- Checked on INSERT of an active party and when an active party changes type. Reactivating a party is
-- not checked (the app does not check it either), so a project already over a cap keeps working and
-- bulk reactivation never fails half-way. Concurrent inserts for one (project, type) are serialised
-- with a transaction-scoped advisory lock so two requests cannot both take the last slot.
-- Forward-only and idempotent.

create or replace function public.project_parties_enforce_type_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
  v_count int;
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active and old.party_type = new.party_type then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.is_active then
    return new; -- reactivation: not capped
  end if;

  v_limit := case new.party_type
    when 'jags' then 10
    when 'client' then 10
    when 'main_contractor' then 10
    when 'tpi_lab' then 25
    when 'vendor' then 100
    when 'subcontractor' then 100
    else null
  end;
  if v_limit is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text || ':' || new.party_type, 0));

  select count(*) into v_count
  from public.project_parties
  where project_id = new.project_id
    and party_type = new.party_type
    and is_active
    and id is distinct from new.id;

  if v_count >= v_limit then
    raise exception 'This project already has % active % parties (the limit is %). Deactivate one before adding another.',
      v_count, replace(new.party_type, '_', ' '), v_limit
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.project_parties_enforce_type_limit() from public, anon, authenticated;
grant execute on function public.project_parties_enforce_type_limit() to service_role;

drop trigger if exists project_parties_enforce_type_limit on public.project_parties;
create trigger project_parties_enforce_type_limit
  before insert or update of party_type, is_active on public.project_parties
  for each row execute function public.project_parties_enforce_type_limit();
