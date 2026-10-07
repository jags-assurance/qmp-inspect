-- Offline sync (C-02, S4-06).
--
-- C-02: standalone measurement / signature replays were de-duplicated by CONTENT, which silently
-- dropped a genuine second identical reading. They are now de-duplicated by the queued item's own
-- idempotency key: client_key is stored on the row, unique per assignment.
-- S4-06: offline evidence keeps its real capture time (captured_at) instead of the sync time.
--
-- Additive and nullable; existing rows are unaffected. The app falls back to its previous behaviour
-- until this is applied. Idempotent.

alter table public.standalone_assignment_measurements
  add column if not exists client_key text;
alter table public.standalone_assignment_signatures
  add column if not exists client_key text;

create unique index if not exists standalone_assignment_measurements_client_key_uidx
  on public.standalone_assignment_measurements (assignment_id, client_key)
  where client_key is not null;
create unique index if not exists standalone_assignment_signatures_client_key_uidx
  on public.standalone_assignment_signatures (assignment_id, client_key)
  where client_key is not null;

alter table public.inspection_photos
  add column if not exists captured_at timestamptz;
alter table public.standalone_assignment_photos
  add column if not exists captured_at timestamptz;

comment on column public.inspection_photos.captured_at is
  'When the photo was actually taken on the device (offline replays sync hours later). Null = taken online; use created_at.';
comment on column public.standalone_assignment_photos.captured_at is
  'When the photo was actually taken on the device. Null = taken online; use created_at.';
