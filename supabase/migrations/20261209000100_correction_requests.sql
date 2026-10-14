-- Correction requests (site-execution audit M7). A contractor / party inspector who executed an
-- inspection (or recorded a sign-off) cannot reopen it or withdraw the sign-off (admin / team lead only),
-- so they file a persistent request; staff approve (which runs the existing reopen / withdraw path with
-- its own permission checks) or decline with a note.
-- (is_team_lead_for_project is not executable by authenticated on the live DB, so policies use is_team_lead_of.)
-- Idempotent. ROLLBACK: drop table if exists public.inspection_correction_requests cascade;
--   drop function if exists public.inspection_correction_requests_guard();
create table if not exists public.inspection_correction_requests (
  id uuid primary key default gen_random_uuid(),
  inspection_record_id uuid references public.inspection_records (id) on delete cascade,
  signoff_progress_id uuid references public.activity_signoff_progress (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  requested_by uuid not null references public.users (id),
  reason text not null check (char_length(btrim(reason)) >= 10),
  status text not null default 'open' check (status in ('open', 'approved', 'declined')),
  resolved_by uuid references public.users (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  check (inspection_record_id is not null or signoff_progress_id is not null)
);

create index if not exists inspection_correction_requests_record_idx
  on public.inspection_correction_requests (inspection_record_id, created_at desc);
create index if not exists inspection_correction_requests_project_status_idx
  on public.inspection_correction_requests (project_id, status);
create index if not exists inspection_correction_requests_requester_idx
  on public.inspection_correction_requests (requested_by);

alter table public.inspection_correction_requests enable row level security;

drop policy if exists inspection_correction_requests_select on public.inspection_correction_requests;
create policy inspection_correction_requests_select on public.inspection_correction_requests
  for select to authenticated using (
    requested_by = (select auth.uid())
    or exists (select 1 from public.team_project_assignments tpa where tpa.project_id = inspection_correction_requests.project_id and public.is_team_lead_of(tpa.team_id))
    or (public.is_jags_staff() and exists (
      select 1 from public.projects p where p.id = project_id and public.has_org_access(p.organization_id)))
  );

drop policy if exists inspection_correction_requests_insert on public.inspection_correction_requests;
create policy inspection_correction_requests_insert on public.inspection_correction_requests
  for insert to authenticated with check (
    requested_by = (select auth.uid())
    and status = 'open'
    and exists (
      select 1 from public.projects p where p.id = project_id and public.has_project_access(p.id, p.organization_id))
  );

drop policy if exists inspection_correction_requests_update on public.inspection_correction_requests;
create policy inspection_correction_requests_update on public.inspection_correction_requests
  for update to authenticated
  using (public.is_admin_staff() or exists (select 1 from public.team_project_assignments tpa where tpa.project_id = inspection_correction_requests.project_id and public.is_team_lead_of(tpa.team_id)))
  with check (public.is_admin_staff() or exists (select 1 from public.team_project_assignments tpa where tpa.project_id = inspection_correction_requests.project_id and public.is_team_lead_of(tpa.team_id)));

-- Only the resolution fields may change, and only once, from open. Decline needs a note.
create or replace function public.inspection_correction_requests_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.inspection_record_id is distinct from old.inspection_record_id
       or new.signoff_progress_id is distinct from old.signoff_progress_id
       or new.project_id is distinct from old.project_id
       or new.requested_by is distinct from old.requested_by
       or new.reason is distinct from old.reason
       or new.created_at is distinct from old.created_at then
      raise exception 'Only the resolution of a correction request can be changed';
    end if;
    if old.status <> 'open' then
      raise exception 'This correction request has already been resolved';
    end if;
    if new.status = 'declined' and char_length(btrim(coalesce(new.resolution_note, ''))) < 5 then
      raise exception 'A note is required to decline a correction request';
    end if;
    if new.status in ('approved', 'declined') then
      new.resolved_by := coalesce(auth.uid(), new.resolved_by);
      new.resolved_at := now();
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists inspection_correction_requests_guard on public.inspection_correction_requests;
create trigger inspection_correction_requests_guard
  before update on public.inspection_correction_requests
  for each row execute function public.inspection_correction_requests_guard();
