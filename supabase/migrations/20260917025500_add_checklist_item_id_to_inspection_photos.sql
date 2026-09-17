-- Round-table field-ops finding: evidence photos could only attach generically to "the whole
-- inspection," never to a SPECIFIC checklist item/finding -- a real gap for audit-trail purposes,
-- since a photo with no clear link to which finding it documents is nearly worthless in a dispute
-- or ISO audit. Nullable and additive: existing photos keep checklist_item_id null and keep
-- showing in the generic "Photo evidence" section exactly as before.
alter table public.inspection_photos
  add column checklist_item_id uuid references public.checklist_items (id) on delete set null;

create index inspection_photos_checklist_item_id_idx on public.inspection_photos (checklist_item_id);
