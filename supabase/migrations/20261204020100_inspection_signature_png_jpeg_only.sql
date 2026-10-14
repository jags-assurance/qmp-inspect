-- Checklist F12: the completion signature must be a drawn PNG or JPEG data URL.
-- The app already enforces this (lib/checklists/evidence-rules.ts), but the database guard only required
-- "data:image/%", so a direct API call could complete an inspection with e.g. an SVG data URL.
-- This re-creates inspection_records_exec_guard identical to the live definition except that one check.
-- Idempotent (create or replace); trigger binding is unchanged.
create or replace function public.inspection_records_exec_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blocker text;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.can_execute_itp_item(new.itp_item_id) then
      raise exception 'Only JAGS staff or the party assigned to this activity can start an inspection' using errcode = '42501';
    end if;
    if public.itp_item_project_id(new.itp_item_id) is distinct from new.project_id then
      raise exception 'The activity does not belong to this project' using errcode = '42501';
    end if;
    if new.checklist_template_id is not null and not exists (
      select 1 from public.checklist_templates t where t.id = new.checklist_template_id and t.itp_item_id = new.itp_item_id
    ) then
      raise exception 'The checklist does not belong to this activity' using errcode = '42501';
    end if;
    if new.overall_result is not null then
      raise exception 'An inspection is completed through the completion step, not created completed' using errcode = '42501';
    end if;
    new.inspector_id := auth.uid();
    return new;
  end if;

  if new.itp_item_id is distinct from old.itp_item_id or new.project_id is distinct from old.project_id then
    raise exception 'An inspection cannot be moved to another activity or project' using errcode = '42501';
  end if;
  if old.overall_result is not null then
    return new;
  end if;
  if not public.can_execute_itp_item(old.itp_item_id) then
    raise exception 'Only JAGS staff or the party assigned to this activity can change this inspection' using errcode = '42501';
  end if;

  if new.overall_result is not null then
    -- Changed: PNG or JPEG data URLs only (was: any data:image/*).
    if new.inspector_signature is null
       or (new.inspector_signature not like 'data:image/png;base64,%'
           and new.inspector_signature not like 'data:image/jpeg;base64,%') then
      raise exception 'A signature is required to complete the inspection' using errcode = '42501';
    end if;
    v_blocker := public.inspection_completion_blocker(old.id, new.overall_result, new.notes);
    if v_blocker is not null then
      raise exception '%', v_blocker using errcode = '42501';
    end if;
    new.signed_by_user_id := auth.uid();
    if new.signed_at is null or new.signed_at > now() + interval '5 minutes' then
      new.signed_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.inspection_records_exec_guard() from public, anon, authenticated;
