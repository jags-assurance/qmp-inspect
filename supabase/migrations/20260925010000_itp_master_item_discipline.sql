-- R32 fix (requirements audit): "Discipline tag exists at each level individually but is dropped
-- during the copy itself." itp_items.discipline_id (20260910060000) lets a client ITP's activities
-- be tagged per-discipline, and itp_master_templates.discipline_id (20260910040000) tags a whole
-- master template — but itp_master_items, the per-activity row inside a master template, never got
-- its own discipline_id column at all. That's the real reason the master<->client copy code (see
-- lib/itp-master/actions.ts) can't carry a per-activity discipline tag through either direction:
-- there was nowhere on the master side to put it. Nullable, same as itp_items.discipline_id —
-- existing master activities are untagged until re-proposed from a tagged client ITP.

alter table public.itp_master_items
  add column discipline_id uuid references public.master_disciplines (id);

create index itp_master_items_discipline_id_idx on public.itp_master_items (discipline_id);
