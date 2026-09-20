-- Closes a real gap found while cross-checking a client-provided sample punch-list document: the
-- app's Data Book override was only ever a boolean + free-text reason
-- (data_books.override_open_punch_items / override_reason,
-- 20260910010000_phase1_punch_list_databook_handover.sql) — it never recorded WHICH items were still
-- open or their agreed due dates. The sample's own wording is explicit: "unless a documented,
-- approved Conditional Handover is issued... listing the open items with agreed due dates" — the
-- itemization is the whole point of the exception, not an afterthought.
--
-- override_items snapshots the actual open punch_list_items at the moment a staff user overrides
-- compilation (id/description/location/due_date/responsible party, captured as plain jsonb rather
-- than a join table, since this is a point-in-time record of what was agreed, not a live-updating
-- list — an item closed later shouldn't retroactively change what the certificate says was open at
-- issue time). conditional_* on handover_certificates carries that same snapshot forward from the
-- data_book at the moment of issue, so the certificate itself is self-contained even if the data_book
-- row is later touched.

alter table public.data_books
  add column override_items jsonb;

comment on column public.data_books.override_items is
  'Snapshot of the project''s open punch_list_items at override time: '
  '[{id, description, location, due_date, responsible_party_name}]. Null unless '
  'override_open_punch_items is true.';

alter table public.handover_certificates
  add column is_conditional boolean not null default false,
  add column conditional_reason text,
  add column conditional_open_items jsonb;

comment on column public.handover_certificates.conditional_open_items is
  'Copied from the source data_book''s override_items at issue time, so the certificate remains a '
  'self-contained record of what was open and agreed even if those punch items are later closed.';
