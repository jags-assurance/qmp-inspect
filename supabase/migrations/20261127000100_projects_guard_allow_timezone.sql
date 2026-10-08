-- C1/C7: the project create/edit forms now set projects.timezone. projects_column_guard (20261118000100)
-- lets a non-admin (self-managed) editor change only the descriptive columns, so timezone is added to
-- that editable list. Everything else in the guard is unchanged.
-- Forward-only and idempotent (create or replace; the trigger already exists).

create or replace function public.projects_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Columns the project-details form is allowed to change for a non-admin (self-managed) editor.
  v_editable constant text[] := array[
    'project_number', 'name', 'site_location', 'country', 'contract_number',
    'start_date', 'end_date', 'timezone', 'updated_at'
  ];
begin
  -- Service role / SQL editor / migrations: trusted.
  if public.is_system_caller() then
    return new;
  end if;

  -- Admin-ness is read from the stored users row, never from the row being written.
  if public.is_admin_staff() then
    return new;
  end if;

  if (to_jsonb(new) - v_editable) is distinct from (to_jsonb(old) - v_editable) then
    raise exception 'Only a JAGS Admin can change this project setting.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.projects_column_guard() from public, anon, authenticated;

drop trigger if exists projects_column_guard on public.projects;
create trigger projects_column_guard
  before update on public.projects
  for each row execute function public.projects_column_guard();
