-- Discipline tagging on standalone assignments (FATs, witness inspections, specific tests,
-- pre-shipment checks) — mirrors 20260910060000_phase3_itp_item_discipline.sql for itp_items.
-- Standalone assignments carry no discipline field at all today, unlike itp_items and (via that
-- link) NCRs, which makes it impossible to filter/report standalone work by discipline. Nullable —
-- tagging is optional, many standalone assignments won't map cleanly to one discipline, and
-- existing assignments are untagged until edited.

alter table public.standalone_assignments
  add column discipline_id uuid references public.master_disciplines (id);

create index standalone_assignments_discipline_id_idx on public.standalone_assignments (discipline_id);
