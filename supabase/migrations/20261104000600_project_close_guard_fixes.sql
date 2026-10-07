-- S1-11: project close guard fixes (builds on 20261019S70004_project_close_guards.sql, which is not
-- edited — it may already be applied by hand because of its non-numeric version).
--
-- Fixes:
--   * `severity <> 'observation'` is NULL for an NCR with no severity, so such an NCR never blocked
--     closing; it is now `coalesce(severity, '') <> 'observation'` (the Data Book readiness code
--     already treats a null severity as a real NCR).
--   * Two more blockers: an unissued Data Book (draft/compiled) and an ITP revision still waiting
--     for approval.
--   * Closing with blockers needs a real reason (at least 5 characters, same minimum the app uses
--     for re-opening) rather than any non-empty string, and the reason is now STORED
--     (projects.closed_reason / closed_at / closed_by), not only written to the audit log.
-- Idempotent.

alter table public.projects add column if not exists closed_reason text;
alter table public.projects add column if not exists closed_at timestamptz;
alter table public.projects add column if not exists closed_by uuid references public.users (id);

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
  v_book int := 0;
  v_rev int := 0;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  if old.status in ('completed', 'cancelled') and not public.is_admin_staff() then
    raise exception 'Only admin staff can reopen a completed or cancelled project';
  end if;

  if new.status = 'completed'
     and coalesce(current_setting('app.close_override', true), '') <> '1' then
    select count(*) into v_ncr from public.ncrs
      where project_id = new.id and status <> 'closed' and coalesce(severity, '') <> 'observation';
    select count(*) into v_punch from public.punch_list_items
      where project_id = new.id and status <> 'closed';
    select count(*) into v_draft from public.inspection_records
      where project_id = new.id and overall_result is null;
    if to_regclass('public.data_books') is not null then
      select count(*) into v_book from public.data_books
        where project_id = new.id and status <> 'issued';
    end if;
    select count(*) into v_rev from public.itps
      where project_id = new.id and revision_needs_approval;
    if v_ncr > 0 or v_punch > 0 or v_draft > 0 or v_book > 0 or v_rev > 0 then
      raise exception 'Cannot complete project: % open NCR(s), % open punch item(s), % draft inspection(s), % unissued data book(s), % ITP revision(s) awaiting approval. Use close_project() with a reason (5+ characters) to override.',
        v_ncr, v_punch, v_draft, v_book, v_rev;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.projects_status_guard() from public, anon, authenticated;

create or replace function public.close_project(p_project_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_org uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
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

  if v_reason is not null and char_length(v_reason) >= 5 then
    perform set_config('app.close_override', '1', true);
  end if;
  update public.projects
    set status = 'completed',
        closed_reason = v_reason,
        closed_at = now(),
        closed_by = auth.uid()
    where id = p_project_id;
  perform set_config('app.close_override', '', true);
end;
$$;
revoke all on function public.close_project(uuid, text) from public, anon;
grant execute on function public.close_project(uuid, text) to authenticated, service_role;
