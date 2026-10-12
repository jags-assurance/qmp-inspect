-- "Who fixes this?": when a checklist item is answered No, the inspector can name the person who
-- will fix it. Idempotent, additive. Not applied automatically.
--
-- Columns live on checklist_responses (the per-item answer row). NULL = nobody named.
-- Writes go through assign_checklist_item_fix(), a SECURITY DEFINER function (same pattern as
-- assign_activity_to_user) so the rules are in one place and checklist_responses RLS is not widened:
--   * caller must pass can_execute_itp_item() for the inspection's activity (JAGS staff or the
--     executing party) - the same rule the checklist_responses exec guard uses;
--   * the item must currently be answered 'no';
--   * the assignee (when not NULL) must be an active user with access to the project: an access
--     grant (user_has_project_access) or an active party login / party member on the project.
-- The existing response write guards are untouched; this function runs as definer, so the
-- checklist_responses exec guard (which also checks can_execute_itp_item via auth.uid()) is a second check.

alter table public.checklist_responses add column if not exists fix_assigned_to uuid references public.users (id) on delete set null;
alter table public.checklist_responses add column if not exists fix_assigned_by uuid references public.users (id) on delete set null;
alter table public.checklist_responses add column if not exists fix_assigned_at timestamptz;

create index if not exists checklist_responses_fix_assigned_to_idx
  on public.checklist_responses (fix_assigned_to) where fix_assigned_to is not null;

-- Naming a fixer must not look like an edit of the answer: the concurrent-edit check compares
-- updated_at, so an assignment-only update keeps updated_at / updated_by as they were.
create or replace function public.checklist_responses_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'fix_assigned_to' - 'fix_assigned_by' - 'fix_assigned_at')
         = (to_jsonb(old) - 'fix_assigned_to' - 'fix_assigned_by' - 'fix_assigned_at') then
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.assign_checklist_item_fix(p_inspection_record_id uuid, p_checklist_item_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_item uuid;
  v_project uuid;
  v_org uuid;
  v_result text;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select r.itp_item_id, r.project_id, p.organization_id into v_item, v_project, v_org
    from public.inspection_records r
    join public.projects p on p.id = r.project_id
   where r.id = p_inspection_record_id;
  if v_item is null then
    raise exception 'Inspection not found' using errcode = 'P0002';
  end if;

  if not public.can_execute_itp_item(v_item) then
    raise exception 'Only JAGS staff or the party assigned to this activity can assign a fix' using errcode = '42501';
  end if;

  select result into v_result from public.checklist_responses
   where inspection_record_id = p_inspection_record_id and checklist_item_id = p_checklist_item_id;
  if v_result is null then
    raise exception 'Answer not found' using errcode = 'P0002';
  end if;
  if v_result <> 'no' then
    raise exception 'A fix can only be assigned to an item answered No' using errcode = '55000';
  end if;

  if p_user_id is not null and not (
    public.user_has_project_access(p_user_id, v_project, v_org)
    or exists (
      select 1 from public.project_parties pp
       where pp.project_id = v_project and pp.is_active
         and (pp.user_id = p_user_id
              or exists (select 1 from public.project_party_members m where m.project_party_id = pp.id and m.user_id = p_user_id))
    )
  ) then
    raise exception 'The assignee must have access to this project' using errcode = '22023';
  end if;

  update public.checklist_responses
     set fix_assigned_to = p_user_id,
         fix_assigned_by = case when p_user_id is null then null else v_caller end,
         fix_assigned_at = case when p_user_id is null then null else now() end
   where inspection_record_id = p_inspection_record_id and checklist_item_id = p_checklist_item_id;
end;
$$;

revoke all on function public.assign_checklist_item_fix(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_checklist_item_fix(uuid, uuid, uuid) to authenticated;
