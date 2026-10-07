-- background_jobs integrity. Idempotent.
--  * started_at: set when status becomes 'processing' (lets the orphan sweep use claim time, not created_at).
--  * requested_by must equal auth.uid() for authenticated inserts (system callers exempt). Implemented
--    as an additive RESTRICTIVE policy so the long per-job-type permissive insert policy is untouched;
--    every web insert site (lib/reports/actions.ts, lib/ncrs/actions.ts) sets payload.requested_by =
--    session.userId.
--  * vault_documents (folder_id, document_reference) unique-approved index: deliberately NOT created
--    (see notice) because both approval and worker auto-file make the new revision approved BEFORE
--    superseding the old one, which a non-deferrable unique index would reject.

alter table public.background_jobs add column if not exists started_at timestamptz;

create or replace function public.background_jobs_set_started_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'processing' and (tg_op = 'INSERT' or old.status is distinct from 'processing') then
    new.started_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.background_jobs_set_started_at() from public, anon, authenticated;

drop trigger if exists background_jobs_set_started_at on public.background_jobs;
create trigger background_jobs_set_started_at
  before insert or update of status on public.background_jobs
  for each row execute function public.background_jobs_set_started_at();

drop policy if exists background_jobs_insert_requester on public.background_jobs;
create policy background_jobs_insert_requester on public.background_jobs
  as restrictive for insert to authenticated
  with check (
    public.is_system_caller()
    or (payload ->> 'requested_by') = auth.uid()::text
  );

do $$
begin
  if exists (
    select 1 from public.vault_documents
    where status = 'approved' and document_reference is not null
    group by folder_id, document_reference having count(*) > 1
  ) then
    raise notice 'vault_documents: duplicate approved (folder_id, document_reference) exist; unique index skipped';
  else
    raise notice 'vault_documents: unique approved-reference index intentionally skipped (would break approve/auto-file ordering: the new approved row exists before the old one is superseded)';
  end if;
end $$;
