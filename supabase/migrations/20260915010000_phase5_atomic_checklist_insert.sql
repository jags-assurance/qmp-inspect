-- Phase 5: transaction safety for checklist generation. generateChecklistsForItp
-- (lib/checklists/actions.ts) previously did its writes as two separate client-side calls — insert
-- every checklist_templates row, then insert every checklist_items row — with real AI calls and a
-- sequential numbering loop in between. If the app crashed, the request timed out, or the second
-- insert failed after the first succeeded, an ITP could be left with checklist_templates rows and
-- no items: a checklist that exists but can never be answered, silently broken until someone
-- notices. A single RPC call runs as one Postgres transaction implicitly - any exception anywhere
-- inside it rolls back everything, so this becomes all-or-nothing instead of partial-by-accident.
--
-- security invoker (the default - stated explicitly for clarity) rather than security definer:
-- this must still respect checklist_templates_write / checklist_items_write's existing RLS, not
-- bypass it. The AI drafting and numbering-sequence logic stay in TypeScript (they call an external
-- API and a separate atomic-counter function respectively) - only the actual row inserts move here.
create or replace function public.insert_checklists_atomic(templates jsonb)
returns table (id uuid, itp_item_id uuid)
language plpgsql
security invoker
as $$
declare
  tmpl jsonb;
  new_template_id uuid;
  item jsonb;
begin
  -- Shape: [{ "itp_item_id": uuid, "checklist_number": text, "name": text,
  --           "items": [{ "item_number": text, "description": text, "is_mandatory": boolean }] }]
  for tmpl in select * from jsonb_array_elements(templates)
  loop
    insert into public.checklist_templates (itp_item_id, checklist_number, name)
    values (
      (tmpl ->> 'itp_item_id')::uuid,
      tmpl ->> 'checklist_number',
      tmpl ->> 'name'
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
