-- Phase 5 / S2-08 follow-up: superseded and withdrawn ITPs (statuses added in 20261103000200) are
--   (1) excluded from the Data Book "ITP not approved" gate, and
--   (2) read-only: their sections and activities cannot be inserted, changed or removed any more.
-- Idempotent. Does not edit earlier migrations.

create or replace function public.data_book_gate_failures(p_project_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out text[] := '{}';
  v_n int;
  v_status text;
begin
  select status into v_status from public.projects where id = p_project_id;
  if v_status is distinct from 'completed' then
    v_out := v_out || ('project status is ' || coalesce(v_status, 'unknown') || ', not completed');
  end if;
  select count(*) into v_n from public.punch_list_items where project_id = p_project_id and status <> 'closed';
  if v_n > 0 then v_out := v_out || (v_n || ' open punch item(s)'); end if;
  select count(*) into v_n from public.ncrs
    where project_id = p_project_id and status <> 'closed' and coalesce(severity, '') <> 'observation';
  if v_n > 0 then v_out := v_out || (v_n || ' open NCR(s)'); end if;
  select count(*) into v_n from public.itps
    where project_id = p_project_id
      and status not in ('superseded', 'withdrawn')
      and (status not in ('approved', 'client_accepted') or coalesce(revision_needs_approval, false));
  if v_n > 0 then v_out := v_out || (v_n || ' ITP(s) not approved'); end if;
  return v_out;
end;
$$;
revoke all on function public.data_book_gate_failures(uuid) from public, anon;
grant execute on function public.data_book_gate_failures(uuid) to authenticated, service_role;

-- Read-only guard for terminal ITPs. Cascades (pg_trigger_depth() > 1, e.g. deleting a whole project)
-- and system callers are not blocked.
create or replace function public.itp_children_block_terminal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_itp uuid;
  v_status text;
  v_number text;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'itp_sections' then
    v_itp := coalesce(new.itp_id, old.itp_id);
  else
    select s.itp_id into v_itp from public.itp_sections s where s.id = coalesce(new.section_id, old.section_id);
  end if;
  if v_itp is null then
    return coalesce(new, old);
  end if;
  select status, itp_number into v_status, v_number from public.itps where id = v_itp;
  if v_status in ('superseded', 'withdrawn') then
    raise exception 'ITP % is % and is read-only', v_number, v_status using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.itp_children_block_terminal() from public, anon, authenticated;

drop trigger if exists itp_sections_block_terminal on public.itp_sections;
create trigger itp_sections_block_terminal before insert or update or delete on public.itp_sections
  for each row execute function public.itp_children_block_terminal();

drop trigger if exists itp_items_block_terminal on public.itp_items;
create trigger itp_items_block_terminal before insert or update or delete on public.itp_items
  for each row execute function public.itp_children_block_terminal();
