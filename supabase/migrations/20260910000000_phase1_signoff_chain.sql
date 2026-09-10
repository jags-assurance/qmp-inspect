-- Phase 1: sign-off chain for the H/W/R/S intervention grid (Reqs R66-R81).
-- activity_party_intervention (20260909230000) records WHICH level a party has on an activity, but
-- nothing tracks WHETHER that party has actually signed off, or enforces that a Hold genuinely
-- blocks progress while a Witness proceeds automatically after a notice period. This migration adds
-- that tracking without touching the existing grid table.
--
-- notice_period_configs: how long an originator waits before a Witness (or, for symmetry, a Hold —
-- though Hold never auto-proceeds, see proceedWithoutResponseAction) is considered "no response",
-- configurable per project rather than hardcoded. No row for a project/intervention pair means the
-- app falls back to the spec's own example numbers (Hold=48h, Witness=24h).
create table public.notice_period_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  intervention text not null check (intervention in ('H', 'W')),
  hours int not null,
  unique (project_id, intervention)
);

-- activity_signoff_progress: one row per (itp_item, project_party) that has an intervention set —
-- kept in lockstep with activity_party_intervention by the trigger below, so every intervention row
-- always has exactly one sign-off row alongside it. Tracks the workflow state machine:
--   pending -> notified -> signed_off
--                       \-> proceeded_no_response (Witness only, after the notice period)
--   pending -> signed_off (a party can sign off directly, e.g. Review/Surveillance, or a Hold/
--   Witness party responding without a separate notify step)
create table public.activity_signoff_progress (
  id uuid primary key default gen_random_uuid(),
  itp_item_id uuid not null references public.itp_items (id) on delete cascade,
  project_party_id uuid not null references public.project_parties (id) on delete cascade,
  intervention text not null check (intervention in ('H', 'W', 'R', 'S')),
  status text not null default 'pending'
    check (status in ('pending', 'notified', 'signed_off', 'proceeded_no_response')),
  notified_at timestamptz,
  signed_off_at timestamptz,
  signed_off_by uuid references public.users (id),
  proceeded_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (itp_item_id, project_party_id)
);

create index activity_signoff_progress_item_idx on public.activity_signoff_progress (itp_item_id);

create trigger activity_signoff_progress_set_updated_at
  before update on public.activity_signoff_progress
  for each row execute function public.set_updated_at();

-- Keeps activity_signoff_progress in sync with activity_party_intervention: setting a party's
-- intervention level on an activity (setInterventionAction) always creates the matching pending
-- sign-off row, so the app never has to remember to do it in two places.
create or replace function public.handle_new_activity_party_intervention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_signoff_progress (itp_item_id, project_party_id, intervention)
  values (new.itp_item_id, new.project_party_id, new.intervention)
  on conflict (itp_item_id, project_party_id)
  do update set intervention = excluded.intervention;
  return new;
end;
$$;

create trigger activity_party_intervention_sync_signoff
  after insert on public.activity_party_intervention
  for each row execute function public.handle_new_activity_party_intervention();

alter table public.notice_period_configs enable row level security;
alter table public.activity_signoff_progress enable row level security;

create policy notice_period_configs_select on public.notice_period_configs
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = notice_period_configs.project_id and public.has_org_access(p.organization_id)
    )
  );

-- Configuring notice periods is ITP content/process setup, mirroring itp_items_staff_write.
create policy notice_period_configs_staff_write on public.notice_period_configs
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy activity_signoff_progress_select on public.activity_signoff_progress
  for select using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_signoff_progress.itp_item_id
        and public.has_org_access(p.organization_id)
    )
  );

-- Deliberately not staff-only (contrast with notice_period_configs_staff_write): notifying,
-- signing off, and proceeding are field execution actions performed by whichever project party is
-- actually involved, the same tenant-isolation-only boundary as inspection_records_write.
create policy activity_signoff_progress_write on public.activity_signoff_progress
  for all using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_signoff_progress.itp_item_id
        and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_signoff_progress.itp_item_id
        and public.has_org_access(p.organization_id)
    )
  );
