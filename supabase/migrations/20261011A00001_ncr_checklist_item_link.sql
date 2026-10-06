-- Link an NCR/observation to the specific checklist item it was raised from.
alter table public.ncrs
  add column if not exists checklist_item_id uuid references public.checklist_items(id) on delete set null;

create index if not exists ncrs_checklist_item_id_idx on public.ncrs (checklist_item_id);
