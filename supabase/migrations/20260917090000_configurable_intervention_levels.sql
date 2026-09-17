-- Makes the ITP sign-off "level" (previously a hardcoded 4-value H/W/R/S enum) custom and
-- hierarchical per organisation, instead of one fixed set for every tenant. The CEO's ask: an org
-- should be able to define its own approval level types (e.g. a 5th "Regulatory Compliance Review"
-- level, or reorder/rename what Hold/Witness mean for them) and have ITPs follow that structure.
--
-- CRITICAL: this table backs 50+ real activity_signoff_progress/activity_party_intervention rows on
-- live projects, all keyed on the literal codes 'H'/'W'/'R'/'S' inserted by migrations
-- 20260909230000_phase1_itp_core.sql and 20260910000000_phase1_signoff_chain.sql. This migration is
-- purely additive at the data level: every existing org is backfilled with the exact same four
-- levels, same codes, same semantics (H blocks, W/R/S don't, same 48h/24h notice defaults), so no
-- existing row's meaning changes. Nothing here renames or renumbers an existing code.
--
-- Design: intervention_level_types rows are ORG-SCOPED (organization_id not null) rather than a
-- shared global set with per-org overrides — every org, including brand-new ones (via the trigger
-- below, same pattern as create_default_vault_folders/create_default_organization_plan), gets its
-- own copy of the four built-in levels it can then freely rename/reorder/extend without touching
-- any other org's rows. This is what lets a real composite FK exist below (organization_id, code),
-- rather than the "no DB FK, app-level check" approach used for drawing_markups.linked_entity_id —
-- that pattern is for a genuinely polymorphic reference; this one has exactly one target table and
-- org-scoped rows make a real FK clean.
create table public.intervention_level_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  label text not null,
  sort_order int not null default 0,
  -- Hold-equivalent levels block progress until cleared (canCompleteInspection); Witness/Review/
  -- Surveillance-equivalent don't. This is the one bit of behaviour that used to be implied by the
  -- literal code 'H' everywhere in application code — now it's data, not a string comparison.
  is_blocking boolean not null default false,
  -- Falls back to the app's hardcoded 48h/24h defaults (DEFAULT_NOTICE_PERIOD_HOURS) when null,
  -- same as before; a project-level notice_period_configs row (if present) still wins over this.
  default_notice_hours int,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create index intervention_level_types_org_idx on public.intervention_level_types (organization_id);

alter table public.intervention_level_types enable row level security;

create policy intervention_level_types_select on public.intervention_level_types
  for select using (public.has_org_access(organization_id));

-- Viewing/using levels is available to any staff/party with org access (needed just to render the
-- picker); actually adding/renaming/reordering levels is an administrative act, gated to JAGS Admin
-- both here and in the server action (lib/intervention-levels/actions.ts), mirroring
-- organization_plans_staff_write / numbering's isAdminStaff() check.
create policy intervention_level_types_admin_write on public.intervention_level_types
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());

-- Seeds the four built-in levels (identical codes/labels/order/blocking/notice-hours to the old
-- hardcoded H/W/R/S enum) for one organisation — shared by the backfill below and the
-- create-on-insert trigger, so both paths can never drift apart.
create or replace function public.seed_default_intervention_levels(target_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.intervention_level_types
    (organization_id, code, label, sort_order, is_blocking, default_notice_hours)
  values
    (target_org_id, 'H', 'Hold', 1, true, 48),
    (target_org_id, 'W', 'Witness', 2, false, 24),
    (target_org_id, 'R', 'Review', 3, false, null),
    (target_org_id, 'S', 'Surveillance', 4, false, null)
  on conflict (organization_id, code) do nothing;
end;
$$;

-- Backfill: every organisation that exists today gets the same four rows the app already behaved
-- as if it had.
do $$
declare
  org record;
begin
  for org in select id from public.organizations loop
    perform public.seed_default_intervention_levels(org.id);
  end loop;
end $$;

-- Future organisations get the same seeded four automatically, same pattern as
-- create_default_vault_folders (20260910010000_phase2_document_vault.sql) and
-- create_default_organization_plan (20260917070000_org_plans_and_seat_limit.sql).
create or replace function public.create_default_intervention_levels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_intervention_levels(new.id);
  return new;
end;
$$;

create trigger organizations_create_default_intervention_levels
  after insert on public.organizations
  for each row execute function public.create_default_intervention_levels();

-- Drop the old fixed-4-value CHECK constraints on both tables that carry an intervention code.
-- activity_party_intervention.intervention and activity_signoff_progress.intervention were already
-- plain `text` columns (the enum was enforced entirely by the CHECK, not the column type), so no
-- column type change is needed — only the constraint.
alter table public.activity_party_intervention drop constraint activity_party_intervention_intervention_check;
alter table public.activity_signoff_progress drop constraint activity_signoff_progress_intervention_check;
-- notice_period_configs.intervention was even narrower (H/W only, since only those two levels ever
-- had a notice period) — generalised the same way so a custom blocking/non-blocking level can also
-- get a per-project notice-period override.
alter table public.notice_period_configs drop constraint notice_period_configs_intervention_check;

-- Replaces the CHECK constraints above: validates that `intervention` is actually one of this
-- activity's organisation's configured intervention_level_types codes, resolved via
-- itp_item -> itp_section -> itp -> project -> organization. A real composite FK isn't possible
-- directly on these tables since neither carries organization_id (only itp_item_id, which is a
-- longer join away) — this trigger is the equivalent integrity check without denormalising
-- organization_id onto 50+ existing live rows.
create or replace function public.validate_activity_intervention_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  code_ok boolean;
begin
  select o.id into org_id
  from public.itp_items it
  join public.itp_sections s on s.id = it.section_id
  join public.itps i on i.id = s.itp_id
  join public.projects p on p.id = i.project_id
  join public.organizations o on o.id = p.organization_id
  where it.id = new.itp_item_id;

  if org_id is null then
    raise exception 'Could not resolve organisation for itp_item %', new.itp_item_id;
  end if;

  select exists (
    select 1 from public.intervention_level_types t
    where t.organization_id = org_id and t.code = new.intervention
  ) into code_ok;

  if not code_ok then
    raise exception 'Intervention code % is not a configured level for this organisation', new.intervention
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger activity_party_intervention_validate_code
  before insert or update of intervention on public.activity_party_intervention
  for each row execute function public.validate_activity_intervention_code();

-- activity_signoff_progress rows are only ever written with an intervention value copied from an
-- already-validated activity_party_intervention row via handle_new_activity_party_intervention
-- (20260910000000_phase1_signoff_chain.sql) — so no separate validation trigger is needed there,
-- same reasoning as before this migration (the CHECK constraint it had was redundant with the
-- sibling table's, just kept in sync by hand).

-- notice_period_configs is set directly by an admin (not derived from another validated row), so it
-- gets its own validation, scoped via project -> organization.
create or replace function public.validate_notice_period_intervention_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_id uuid;
  code_ok boolean;
begin
  select p.organization_id into org_id from public.projects p where p.id = new.project_id;

  if org_id is null then
    raise exception 'Could not resolve organisation for project %', new.project_id;
  end if;

  select exists (
    select 1 from public.intervention_level_types t
    where t.organization_id = org_id and t.code = new.intervention
  ) into code_ok;

  if not code_ok then
    raise exception 'Intervention code % is not a configured level for this organisation', new.intervention
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger notice_period_configs_validate_code
  before insert or update of intervention on public.notice_period_configs
  for each row execute function public.validate_notice_period_intervention_code();

-- Prevents an admin from deleting/renaming-away-from-under a level that's actually in use, so a
-- settings-page delete can never silently orphan real sign-off rows. Renaming (UPDATE of label,
-- sort_order, is_blocking, default_notice_hours) is always fine — only the code itself is the
-- identity that other rows key off, so only a code change or delete is guarded.
create or replace function public.prevent_intervention_level_type_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  in_use boolean;
begin
  select exists (
    select 1
    from public.activity_party_intervention api
    join public.itp_items it on it.id = api.itp_item_id
    join public.itp_sections s on s.id = it.section_id
    join public.itps i on i.id = s.itp_id
    join public.projects p on p.id = i.project_id
    where p.organization_id = old.organization_id and api.intervention = old.code
  ) into in_use;

  if in_use then
    raise exception 'Intervention level % (%) is in use on at least one activity and cannot be removed'
      , old.label, old.code
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger intervention_level_types_prevent_removal
  before delete on public.intervention_level_types
  for each row execute function public.prevent_intervention_level_type_removal();

-- Also guard a code change specifically (UPDATE changing `code` out from under existing rows) —
-- separate trigger since the DELETE-shaped check above reads OLD, but an UPDATE that changes the
-- code needs the same "is the OLD code still referenced" check only when code actually changes.
create or replace function public.prevent_intervention_level_type_code_change_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  in_use boolean;
begin
  if new.code = old.code then
    return new;
  end if;

  select exists (
    select 1
    from public.activity_party_intervention api
    join public.itp_items it on it.id = api.itp_item_id
    join public.itp_sections s on s.id = it.section_id
    join public.itps i on i.id = s.itp_id
    join public.projects p on p.id = i.project_id
    where p.organization_id = old.organization_id and api.intervention = old.code
  ) into in_use;

  if in_use then
    raise exception 'Intervention level % (%) is in use on at least one activity and its code cannot be changed'
      , old.label, old.code
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger intervention_level_types_prevent_code_change
  before update of code on public.intervention_level_types
  for each row execute function public.prevent_intervention_level_type_code_change_in_use();
