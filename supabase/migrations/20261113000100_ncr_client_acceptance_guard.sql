-- Database guard for the NCR client-acceptance columns (added by 20261110000400). Until now only the
-- server action protected them, so any user who could update an NCR row through the API could set
-- client_accepted_*, flip client_acceptance_required, or close an NCR that still needed acceptance.
-- Mirrors lib/ncrs/acceptance.ts. Exempt: is_system_caller() and nested trigger calls
-- (pg_trigger_depth() > 1). Idempotent; a new trigger, no existing function is redefined.
--
--   * client_acceptance_required: JAGS staff only.
--   * client_accepted_at / by / decision / comment: the client's own login on the project, or an Admin
--     (on their behalf). Staff may also clear them (the action clears them when it toggles the flag).
--   * Closing an NCR that requires acceptance needs decision = 'accepted' (withdrawals are exempt).

create or replace function public.is_project_client_party_user(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_parties pp
    where pp.project_id = p_project_id
      and pp.party_type = 'client'
      and pp.is_active
      and (
        pp.user_id = auth.uid()
        or exists (
          select 1 from public.project_party_members m
          where m.project_party_id = pp.id and m.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.is_project_client_party_user(uuid) from public, anon;
grant execute on function public.is_project_client_party_user(uuid) to authenticated;

create or replace function public.ncrs_client_acceptance_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision_changed boolean;
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.client_acceptance_required is distinct from old.client_acceptance_required
     and not public.is_jags_staff() then
    raise exception 'Only JAGS staff can change whether client acceptance is required.' using errcode = '42501';
  end if;

  v_decision_changed :=
    new.client_accepted_at is distinct from old.client_accepted_at
    or new.client_accepted_by is distinct from old.client_accepted_by
    or new.client_acceptance_decision is distinct from old.client_acceptance_decision
    or new.client_acceptance_comment is distinct from old.client_acceptance_comment;

  if v_decision_changed then
    if new.client_acceptance_decision is null
       and new.client_accepted_at is null
       and new.client_accepted_by is null
       and new.client_acceptance_comment is null then
      -- Clearing the decision (the flag was toggled / a new acceptance round): staff only.
      if not public.is_jags_staff() then
        raise exception 'Only JAGS staff can clear a client acceptance decision.' using errcode = '42501';
      end if;
    else
      if not (public.is_admin_staff() or public.is_project_client_party_user(new.project_id)) then
        raise exception 'Only the client''s own login (or a JAGS admin on their behalf) can record the acceptance decision.' using errcode = '42501';
      end if;
      if not coalesce(new.client_acceptance_required, false) then
        raise exception 'Client acceptance is not required on this NCR.' using errcode = '23514';
      end if;
      if new.client_accepted_by is distinct from auth.uid() then
        raise exception 'The acceptance must be recorded under your own account.' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed'
     and new.withdrawn_at is null
     and coalesce(new.client_acceptance_required, false)
     and new.client_acceptance_decision is distinct from 'accepted' then
    raise exception 'The client has to accept the disposition before this NCR can be closed.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.ncrs_client_acceptance_guard() from public, anon, authenticated;

drop trigger if exists ncrs_client_acceptance_guard on public.ncrs;
create trigger ncrs_client_acceptance_guard
  before update on public.ncrs
  for each row execute function public.ncrs_client_acceptance_guard();
