-- S4-09 (remainder) and S5-05 (remainder). Idempotent, additive: two small separate triggers, so no
-- existing guard function is redefined.
--
-- S4-09: re-opening a completed inspection is a controlled amendment (admin staff or a lead of a team
-- assigned to the project). The app already checks this; reopen_inspection() is SECURITY INVOKER and
-- writes the amendment row first, in the same transaction, so a guard on that insert enforces the rule
-- atomically for every caller (RPC, step-by-step fallback, direct API calls).
--
-- S5-05: a punch item raised from an NCR cannot be re-opened while its source NCR is still closed
-- (re-open the NCR first; the NCR re-open cascade sets the NCR status before it touches the punch
-- item, so it is not affected).

create or replace function public.inspection_amendment_authority_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
begin
  if public.is_system_caller() then
    return new;
  end if;
  select r.project_id into v_project from public.inspection_records r where r.id = new.record_id;
  if v_project is null then
    return new;
  end if;
  if not (public.is_admin_staff() or public.is_team_lead_for_project(v_project)) then
    raise exception 'Only an admin or a team lead on this project can re-open a completed inspection' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.inspection_amendment_authority_guard() from public, anon, authenticated;

drop trigger if exists inspection_amendment_authority_guard on public.inspection_record_amendments;
create trigger inspection_amendment_authority_guard
  before insert on public.inspection_record_amendments
  for each row execute function public.inspection_amendment_authority_guard();

create or replace function public.punch_reopen_ncr_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ncr_status text;
begin
  if public.is_system_caller() then
    return new;
  end if;
  if old.status = 'closed' and new.status = 'open' and old.source_ncr_id is not null and old.withdrawn_at is null then
    select n.status into v_ncr_status from public.ncrs n where n.id = old.source_ncr_id;
    if v_ncr_status = 'closed' then
      raise exception 'The source NCR is closed. Re-open the NCR first; its punch item re-opens with it' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.punch_reopen_ncr_closed_guard() from public, anon, authenticated;

drop trigger if exists punch_reopen_ncr_closed_guard on public.punch_list_items;
create trigger punch_reopen_ncr_closed_guard
  before update on public.punch_list_items
  for each row execute function public.punch_reopen_ncr_closed_guard();
