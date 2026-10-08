-- H15: attaching a checklist library template created the checklist_templates row and its items in two
-- separate requests, so a failure between them left an empty checklist the activity then refused to
-- replace. This function does both in ONE transaction. SECURITY INVOKER, so the caller's RLS still
-- decides whether each insert is allowed. Idempotent.
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

  insert into public.checklist_items (template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order)
  select v_template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order
  from public.checklist_library_items
  where library_template_id = p_library_template_id
  order by sort_order;

  return v_template_id;
end;
$$;

revoke all on function public.attach_library_template_atomic(uuid, uuid, text, text) from public, anon;
grant execute on function public.attach_library_template_atomic(uuid, uuid, text, text) to authenticated;
