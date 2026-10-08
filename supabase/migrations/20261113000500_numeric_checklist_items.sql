-- S4-20: a numeric checklist response type with a tolerance. An item can be a measured value with a
-- minimum and/or maximum and a unit. The inspector records the number; the SERVER derives the result
-- ('yes' inside the limits, 'no' outside), so every rule that already works on yes / no / na keeps
-- working unchanged (completion, NCR from a failed item, evidence, readiness). Additive and idempotent:
-- existing items stay pass/fail. Items freeze once responses exist (20261106000100), so the limits can't
-- be changed under a recorded answer.
alter table public.checklist_items
  add column if not exists value_type text not null default 'pass_fail',
  add column if not exists numeric_min numeric,
  add column if not exists numeric_max numeric,
  add column if not exists numeric_unit text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_items_value_type_check') then
    alter table public.checklist_items
      add constraint checklist_items_value_type_check check (value_type in ('pass_fail', 'numeric'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_items_numeric_limits_check') then
    alter table public.checklist_items
      add constraint checklist_items_numeric_limits_check check (
        value_type = 'pass_fail'
        or (
          (numeric_min is not null or numeric_max is not null)
          and (numeric_min is null or numeric_max is null or numeric_min <= numeric_max)
        )
      );
  end if;
end $$;

alter table public.checklist_responses
  add column if not exists numeric_value numeric;

-- Library templates copy the same fields when attached.
alter table public.checklist_library_items
  add column if not exists value_type text not null default 'pass_fail',
  add column if not exists numeric_min numeric,
  add column if not exists numeric_max numeric,
  add column if not exists numeric_unit text;

-- Carry the numeric fields through the two copy paths so a duplicated or library-attached checklist keeps
-- its measured items (both functions are SECURITY INVOKER; signatures unchanged).
create or replace function public.duplicate_checklist_template(
  p_source_template_id uuid,
  p_target_itp_item_id uuid,
  p_checklist_number text,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new uuid;
  v_n int;
begin
  select count(*) into v_n from public.checklist_items where template_id = p_source_template_id;
  if v_n = 0 then
    raise exception 'source checklist has no items' using errcode = 'P0001';
  end if;

  insert into public.checklist_templates (itp_item_id, checklist_number, name)
  values (p_target_itp_item_id, p_checklist_number, p_name)
  returning id into v_new;

  insert into public.checklist_items (template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order, value_type, numeric_min, numeric_max, numeric_unit)
  select v_new, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order, value_type, numeric_min, numeric_max, numeric_unit
    from public.checklist_items
   where template_id = p_source_template_id
   order by sort_order;

  return v_new;
end;
$$;
revoke all on function public.duplicate_checklist_template(uuid, uuid, text, text) from public, anon;
grant execute on function public.duplicate_checklist_template(uuid, uuid, text, text) to authenticated;

create or replace function public.attach_library_template_atomic(
  p_library_template_id uuid,
  p_itp_item_id uuid,
  p_checklist_number text,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_template_id uuid;
  v_count int;
begin
  select count(*) into v_count from public.checklist_library_items where library_template_id = p_library_template_id;
  if v_count = 0 then
    raise exception 'library template has no items' using errcode = 'P0001';
  end if;

  insert into public.checklist_templates (itp_item_id, checklist_number, name)
  values (p_itp_item_id, p_checklist_number, p_name)
  returning id into v_template_id;

  insert into public.checklist_items (template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order, value_type, numeric_min, numeric_max, numeric_unit)
  select v_template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order, value_type, numeric_min, numeric_max, numeric_unit
  from public.checklist_library_items
  where library_template_id = p_library_template_id
  order by sort_order;

  return v_template_id;
end;
$$;
revoke all on function public.attach_library_template_atomic(uuid, uuid, text, text) from public, anon;
grant execute on function public.attach_library_template_atomic(uuid, uuid, text, text) to authenticated;
