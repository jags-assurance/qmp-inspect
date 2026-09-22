-- R23: three-phase ITP lifecycle (Development / Execution / Handover) — a real, derived concept
-- distinct from itps.status (draft/under_review/approved/client_accepted, which tracks the
-- approval workflow on the ITP DOCUMENT itself). `phase` tracks where the ITP sits in the
-- project's real-world lifecycle:
--   development: the document itself is being drafted/reviewed/approved (status is draft,
--     under_review, or approved — not yet client_accepted).
--   execution: the ITP has been issued (client_accepted) and inspections/sign-offs are actively
--     happening against it — at least one blocking (Hold-equivalent) sign-off across the ITP's
--     activities is not yet signed_off.
--   handover: the ITP's execution work is complete — every blocking sign-off across every activity
--     is signed_off (or there are no blocking levels configured for the org at all) — the same
--     readiness signal canCompleteInspection (apps/web/lib/signoff/actions.ts) already checks
--     per-activity, applied here across the whole ITP.
--
-- Deliberately NOT a plain generated column: Postgres `GENERATED ALWAYS AS` can only reference
-- columns on the same row, but phase depends on activity_signoff_progress/itp_items/itp_sections
-- rows elsewhere and on the org's own intervention_level_types.is_blocking configuration. Instead
-- this is a real, stored column kept in sync by triggers — the same "not a manually-set field a
-- user edits" guarantee as a generated column, just spanning tables. No policy grants UPDATE on
-- this column to anyone outside these triggers, so a client can't set it directly (RLS still checks
-- itps_u below, but no application code ever includes `phase` in an update payload).

alter table public.itps
  add column phase text not null default 'development'
    check (phase in ('development', 'execution', 'handover'));

create index itps_phase_idx on public.itps (phase);

-- Computes what phase an ITP should be in right now, from its own status plus the sign-off state
-- of its activities. security definer + fixed search_path so this can read across
-- projects/intervention_level_types/activity_signoff_progress/itp_items/itp_sections regardless of
-- the caller's own RLS visibility (mirrors accept_itp() in
-- 20260910110000_phase3_accept_itp_client_only.sql) — it only ever writes the single `phase`
-- column, never returns or otherwise leaks any of the rows it reads.
create or replace function public.compute_itp_phase(p_itp_id uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status text;
  v_org_id uuid;
  v_blocking_codes text[];
  v_unfinished_count int;
begin
  select i.status, p.organization_id
  into v_status, v_org_id
  from public.itps i
  join public.projects p on p.id = i.project_id
  where i.id = p_itp_id;

  if v_status is null then
    return 'development';
  end if;

  if v_status in ('draft', 'under_review', 'approved') then
    return 'development';
  end if;

  -- From here, v_status = 'client_accepted': either 'execution' or 'handover'.
  select array_agg(code) into v_blocking_codes
  from public.intervention_level_types
  where organization_id = v_org_id and is_blocking = true;

  if v_blocking_codes is null or array_length(v_blocking_codes, 1) is null then
    -- No blocking (Hold-equivalent) levels configured for this org at all — nothing gates
    -- handover readiness, mirroring canCompleteInspection's own "no blocking levels -> never
    -- held" fallback (apps/web/lib/signoff/actions.ts).
    return 'handover';
  end if;

  select count(*) into v_unfinished_count
  from public.activity_signoff_progress asp
  join public.itp_items ii on ii.id = asp.itp_item_id
  join public.itp_sections isec on isec.id = ii.section_id
  where isec.itp_id = p_itp_id
    and asp.intervention = any(v_blocking_codes)
    and asp.status <> 'signed_off';

  if v_unfinished_count > 0 then
    return 'execution';
  end if;

  return 'handover';
end;
$$;

-- Keeps itps.phase in sync whenever status changes (submit for review / approve / client accept).
-- AFTER, not BEFORE: compute_itp_phase re-selects status by id, which must see the already-applied
-- new value, not the pre-update one.
create or replace function public.sync_itp_phase_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.itps set phase = public.compute_itp_phase(new.id) where id = new.id;
  return new;
end;
$$;

create trigger itps_phase_sync
  after insert or update of status on public.itps
  for each row execute function public.sync_itp_phase_on_status_change();

-- Keeps itps.phase in sync whenever a blocking sign-off's status changes (notified/signed_off/
-- proceeded, or a row added/removed) — this is the actual execution -> handover trigger once
-- status is already client_accepted.
create or replace function public.sync_itp_phase_from_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid := coalesce(new.itp_item_id, old.itp_item_id);
  v_itp_id uuid;
begin
  select isec.itp_id into v_itp_id
  from public.itp_items ii
  join public.itp_sections isec on isec.id = ii.section_id
  where ii.id = v_item_id;

  if v_itp_id is not null then
    update public.itps set phase = public.compute_itp_phase(v_itp_id) where id = v_itp_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger activity_signoff_progress_phase_sync
  after insert or update or delete on public.activity_signoff_progress
  for each row execute function public.sync_itp_phase_from_signoff();

-- An org changing which intervention levels are blocking (or adding/removing one) can also flip
-- phase for every one of its client_accepted ITPs — rare (an admin-only config change), so a
-- straightforward per-org recompute rather than anything more elaborate.
create or replace function public.sync_itp_phase_from_intervention_level_types()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  update public.itps i
  set phase = public.compute_itp_phase(i.id)
  from public.projects p
  where p.id = i.project_id
    and p.organization_id = v_org_id
    and i.status = 'client_accepted';

  return coalesce(new, old);
end;
$$;

create trigger intervention_level_types_phase_sync
  after insert or update or delete on public.intervention_level_types
  for each row execute function public.sync_itp_phase_from_intervention_level_types();

-- Backfill: every existing ITP's phase, computed from its current status/sign-off state — the same
-- function the triggers above use going forward, so existing and newly-touched rows are computed
-- identically.
update public.itps set phase = public.compute_itp_phase(id);
