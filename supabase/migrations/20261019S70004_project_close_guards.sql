-- Stage 7: block writes on completed/cancelled projects, guard status transitions, close_project RPC.
-- Idempotent.

create or replace function public.project_is_writable(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.status in ('completed', 'cancelled')
  );
$$;
revoke all on function public.project_is_writable(uuid) from public, anon;
grant execute on function public.project_is_writable(uuid) to authenticated, service_role;

-- Generic guard. project_id is resolved from the row JSON so one function serves every table.
create or replace function public.project_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_pid uuid;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() or public.is_admin_staff() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name in ('ncrs', 'punch_list_items', 'inspection_records', 'standalone_assignments') then
    v_pid := nullif(v_row->>'project_id', '')::uuid;
  elsif tg_table_name = 'irns' then
    v_pid := nullif(v_row->>'project_id', '')::uuid;
    if v_pid is null then
      select r.project_id into v_pid from public.inspection_records r
        where r.id = nullif(v_row->>'inspection_record_id', '')::uuid;
    end if;
  elsif tg_table_name = 'checklist_responses' then
    select r.project_id into v_pid from public.inspection_records r
      where r.id = nullif(v_row->>'inspection_record_id', '')::uuid;
  elsif tg_table_name = 'activity_signoff_progress' then
    select i.project_id into v_pid
    from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
    where it.id = nullif(v_row->>'itp_item_id', '')::uuid;
  elsif tg_table_name = 'vault_documents' then
    select f.project_id into v_pid from public.vault_folders f
      where f.id = nullif(v_row->>'folder_id', '')::uuid;
  end if;

  if v_pid is not null and not public.project_is_writable(v_pid) then
    raise exception 'This project is completed or cancelled; changes are not allowed';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.project_write_guard() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['ncrs','punch_list_items','inspection_records','checklist_responses',
                           'activity_signoff_progress','irns','standalone_assignments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists project_write_guard on public.%I', t);
      execute format('create trigger project_write_guard before insert or update or delete on public.%I for each row execute function public.project_write_guard()', t);
    end if;
  end loop;
  if to_regclass('public.vault_documents') is not null then
    drop trigger if exists project_write_guard on public.vault_documents;
    create trigger project_write_guard before insert on public.vault_documents
      for each row execute function public.project_write_guard();
  end if;
end $$;

-- projects: status transition guard
create or replace function public.projects_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ncr int;
  v_punch int;
  v_draft int;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  -- projects has no reason column, so only admin staff is enforced when leaving a terminal status.
  if old.status in ('completed', 'cancelled') and not public.is_admin_staff() then
    raise exception 'Only admin staff can reopen a completed or cancelled project';
  end if;

  if new.status = 'completed'
     and coalesce(current_setting('app.close_override', true), '') <> '1' then
    select count(*) into v_ncr from public.ncrs
      where project_id = new.id and status <> 'closed' and severity <> 'observation';
    select count(*) into v_punch from public.punch_list_items
      where project_id = new.id and status <> 'closed';
    select count(*) into v_draft from public.inspection_records
      where project_id = new.id and overall_result is null;
    if v_ncr > 0 or v_punch > 0 or v_draft > 0 then
      raise exception 'Cannot complete project: % open NCR(s), % open punch item(s), % draft inspection(s). Use close_project() with a reason to override.',
        v_ncr, v_punch, v_draft;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.projects_status_guard() from public, anon, authenticated;

drop trigger if exists projects_status_guard on public.projects;
create trigger projects_status_guard
  before update on public.projects
  for each row execute function public.projects_status_guard();

create or replace function public.close_project(p_project_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_org uuid;
begin
  select status, organization_id into v_status, v_org from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;
  if not public.is_system_caller() then
    if not public.is_admin_staff() then
      raise exception 'Only admin staff can close a project';
    end if;
    if not public.has_project_access(p_project_id, v_org) then
      raise exception 'No access to this project';
    end if;
  end if;
  if v_status = 'completed' then
    raise exception 'Project is already completed';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    perform set_config('app.close_override', '1', true);
  end if;
  update public.projects set status = 'completed' where id = p_project_id;
  perform set_config('app.close_override', '', true);
end;
$$;
revoke all on function public.close_project(uuid, text) from public, anon;
grant execute on function public.close_project(uuid, text) to authenticated, service_role;
