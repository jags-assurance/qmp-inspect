-- Organisation lifecycle: deactivate / reactivate (soft, never deletes data).
-- Idempotent. Rollback note: re-create project_is_writable() with the previous body
--   (status not in ('completed','cancelled') only), drop trigger projects_org_active_guard and
--   organizations_deactivation_guard, then optionally drop the three deactivated_* columns.
-- Who may change name/is_active is already enforced by organizations_update RLS (is_admin_staff) and the
-- organizations_column_guard / restrict_self_managed_org_update triggers; this migration adds the audit
-- columns, a mandatory reason, and makes projects of an inactive organisation read-only.

alter table public.organizations add column if not exists deactivated_at timestamptz;
alter table public.organizations add column if not exists deactivated_by uuid;
alter table public.organizations add column if not exists deactivation_reason text;

create or replace function public.organizations_deactivation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active is not distinct from old.is_active then
    return new;
  end if;
  if not new.is_active then
    if public.is_system_caller() then
      new.deactivated_at := coalesce(new.deactivated_at, now());
      return new;
    end if;
    if nullif(btrim(coalesce(new.deactivation_reason, '')), '') is null then
      raise exception 'A reason is required to deactivate an organisation' using errcode = '23514';
    end if;
    new.deactivated_at := now();
    new.deactivated_by := auth.uid();
  else
    new.deactivated_at := null;
    new.deactivated_by := null;
    -- reason is kept in the audit trail; clear the live column
    new.deactivation_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function public.organizations_deactivation_guard() from public, anon, authenticated;

drop trigger if exists organizations_deactivation_guard on public.organizations;
create trigger organizations_deactivation_guard
  before update on public.organizations
  for each row execute function public.organizations_deactivation_guard();

-- Projects of an inactive organisation are read-only, exactly like completed/cancelled projects.
create or replace function public.project_is_writable(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.projects p
    left join public.organizations o on o.id = p.organization_id
    where p.id = p_project_id
      and (p.status in ('completed', 'cancelled') or coalesce(o.is_active, true) = false)
  );
$$;
revoke all on function public.project_is_writable(uuid) from public, anon;
grant execute on function public.project_is_writable(uuid) to authenticated, service_role;

-- Same body as the live guard; only the message is generalised.
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
  else
    v_pid := nullif(v_row->>'project_id', '')::uuid;
  end if;

  if v_pid is not null and not public.project_is_writable(v_pid) then
    raise exception 'This project is completed, cancelled or belongs to an inactive organisation; changes are not allowed';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.project_write_guard() from public, anon, authenticated;

-- No new projects in an inactive organisation (applies to everyone except the system caller; reactivate first).
create or replace function public.projects_org_active_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() then
    return new;
  end if;
  if exists (select 1 from public.organizations o where o.id = new.organization_id and o.is_active = false) then
    raise exception 'This organisation is inactive; reactivate it before creating projects' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.projects_org_active_guard() from public, anon, authenticated;

drop trigger if exists projects_org_active_guard on public.projects;
create trigger projects_org_active_guard
  before insert on public.projects
  for each row execute function public.projects_org_active_guard();
