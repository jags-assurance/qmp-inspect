-- Atomic duplicate guard for NCRs raised from a retried submit or an offline replay.
-- Until now the guard was a marker object in the inspection-evidence bucket (claim + done markers),
-- which is two steps and leaves a window. A unique (project_id, request_id) on ncrs makes the
-- database the single arbiter: the second insert with the same key fails with 23505 and the app
-- returns the NCR the first insert created.
-- Existing rows keep request_id null (partial index), so nothing needs back-filling.
-- Forward-only and idempotent.

alter table public.ncrs add column if not exists request_id text;

alter table public.ncrs drop constraint if exists ncrs_request_id_length;
alter table public.ncrs
  add constraint ncrs_request_id_length check (request_id is null or char_length(request_id) between 1 and 64);

create unique index if not exists ncrs_project_request_id_uidx
  on public.ncrs (project_id, request_id)
  where request_id is not null;
