-- AI-generated checklist review stage. Idempotent, additive.
--
-- An AI-generated checklist template is saved as a DRAFT (ai_generated = true, ai_confirmed_at null)
-- that JAGS staff must confirm before an inspection can start from it. Human-built templates
-- (library attach, blank, manual) have ai_generated = false and are unaffected. Existing rows
-- default to ai_generated = false, so nothing already in use becomes blocked.

alter table public.checklist_templates add column if not exists ai_generated boolean not null default false;
alter table public.checklist_templates add column if not exists ai_confirmed_at timestamptz;
alter table public.checklist_templates add column if not exists ai_confirmed_by uuid references public.users (id) on delete set null;

-- Same signature as 20260915010000; additionally reads an optional per-template "ai_generated" flag.
create or replace function public.insert_checklists_atomic(templates jsonb)
returns table (id uuid, itp_item_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  tmpl jsonb;
  new_template_id uuid;
  item jsonb;
begin
  for tmpl in select * from jsonb_array_elements(templates)
  loop
    insert into public.checklist_templates (itp_item_id, checklist_number, name, ai_generated)
    values (
      (tmpl ->> 'itp_item_id')::uuid,
      tmpl ->> 'checklist_number',
      tmpl ->> 'name',
      coalesce((tmpl ->> 'ai_generated')::boolean, false)
    )
    returning public.checklist_templates.id into new_template_id;

    for item in select * from jsonb_array_elements(tmpl -> 'items')
    loop
      insert into public.checklist_items (template_id, item_number, description, is_mandatory, sort_order)
      values (
        new_template_id,
        item ->> 'item_number',
        item ->> 'description',
        coalesce((item ->> 'is_mandatory')::boolean, true),
        coalesce((item ->> 'sort_order')::int, 0)
      );
    end loop;

    id := new_template_id;
    itp_item_id := (tmpl ->> 'itp_item_id')::uuid;
    return next;
  end loop;
end;
$$;

-- Defence in depth: an inspection cannot be opened from an unconfirmed AI draft, whatever the client.
create or replace function public.inspection_records_ai_draft_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.checklist_template_id is null or public.is_system_caller() then
    return new;
  end if;
  if exists (
    select 1 from public.checklist_templates t
     where t.id = new.checklist_template_id and t.ai_generated and t.ai_confirmed_at is null
  ) then
    raise exception 'This AI-generated checklist has not been confirmed by JAGS staff yet' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.inspection_records_ai_draft_guard() from public, anon, authenticated;

drop trigger if exists inspection_records_ai_draft_guard on public.inspection_records;
create trigger inspection_records_ai_draft_guard
  before insert on public.inspection_records
  for each row execute function public.inspection_records_ai_draft_guard();
