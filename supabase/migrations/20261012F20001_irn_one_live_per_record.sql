-- A voided IRN must be replaceable: replace the blanket UNIQUE on inspection_record_id with a
-- partial unique index so only one LIVE (non-voided) IRN may exist per inspection record.
alter table public.irns drop constraint if exists irns_inspection_record_id_key;

create unique index if not exists irns_one_live_per_record
  on public.irns (inspection_record_id)
  where voided_at is null;
