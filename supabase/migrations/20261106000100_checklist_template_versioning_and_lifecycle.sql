-- PHASE 3 (QMP Inspect audit): checklist template lifecycle + versioning. Idempotent, additive.
--
--  * checklist_templates.version      bumped by the app on every item add/edit/delete/reorder
--  * checklist_templates.archived_*   soft-archive (a used template is archived, never deleted)
--  * inspection_records.checklist_template_version / checklist_items_snapshot
--                                      frozen copy of the item set taken when an inspection starts
--  * DB freeze guards: items cannot be edited/deleted once any response exists for the template;
--    a template that has inspection records cannot be deleted.
--  * duplicate_checklist_template()   copies a template + items onto another activity, atomically

alter table public.checklist_templates add column if not exists version integer not null default 1;
alter table public.checklist_templates add column if not exists archived_at timestamptz;
alter table public.checklist_templates add column if not exists archived_by uuid references public.users (id);

alter table public.inspection_records add column if not exists checklist_template_version integer;
alter table public.inspection_records add column if not exists checklist_items_snapshot jsonb;

-- Freeze guard: item edit / delete / reorder is refused once any inspection response exists for the
-- template. Cascades from a template delete (trigger depth > 1) and system callers are left alone.
create or replace function public.checklist_items_freeze_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template uuid := case when tg_op = 'DELETE' then old.template_id else new.template_id end;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return coalesce(new, old);
  end if;
  if exists (
    select 1
      from public.checklist_responses r
      join public.checklist_items i on i.id = r.checklist_item_id
     where i.template_id = v_template
  ) then
    raise exception 'This checklist already has inspection responses; its items can no longer be changed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.checklist_items_freeze_guard() from public, anon, authenticated;

drop trigger if exists checklist_items_freeze_guard on public.checklist_items;
create trigger checklist_items_freeze_guard
  before update or delete on public.checklist_items
  for each row execute function public.checklist_items_freeze_guard();

-- A template that inspections were run against is archived, not deleted (history must stay readable).
create or replace function public.checklist_templates_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return old;
  end if;
  if exists (select 1 from public.inspection_records r where r.checklist_template_id = old.id) then
    raise exception 'This checklist has inspection records; archive it instead of deleting it' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.checklist_templates_delete_guard() from public, anon, authenticated;

drop trigger if exists checklist_templates_delete_guard on public.checklist_templates;
create trigger checklist_templates_delete_guard
  before delete on public.checklist_templates
  for each row execute function public.checklist_templates_delete_guard();

-- SECURITY INVOKER: the caller's RLS decides whether each insert is allowed. checklist_templates has
-- one row per activity (itp_item_id is unique), so a duplicate always targets another activity.
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

  insert into public.checklist_items (template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order)
  select v_new, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order
    from public.checklist_items
   where template_id = p_source_template_id
   order by sort_order;

  return v_new;
end;
$$;
revoke all on function public.duplicate_checklist_template(uuid, uuid, text, text) from public, anon;
grant execute on function public.duplicate_checklist_template(uuid, uuid, text, text) to authenticated;
