-- 20261117000200 recreated attach_library_template_atomic from the pre-20261113000500 body and so stopped
-- copying value_type / numeric_min / numeric_max / numeric_unit from the library items: numeric limits were
-- lost when a library template was attached. This restores that copy and keeps the 20261117000200 behaviour
-- (single transaction, SECURITY INVOKER, empty-template guard). Latest definition wins. Idempotent; the
-- checklist_*items numeric columns come from 20261113000500.
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
