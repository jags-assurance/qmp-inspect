-- Phase 3: discipline tagging on ITP activities (Reqs R32) — each activity can be tagged with the
-- discipline responsible for it (CIV/STR/ARC/MEC/ELE/INS/PIP/HVAC/HSE, seeded in Phase 0's
-- master_disciplines), so a multi-discipline ITP's activities can be filtered/routed by discipline
-- instead of being an undifferentiated flat list. Nullable — tagging is optional, not every project
-- needs discipline-level breakdown, and existing activities are untagged until edited.

alter table public.itp_items
  add column discipline_id uuid references public.master_disciplines (id);

create index itp_items_discipline_id_idx on public.itp_items (discipline_id);
