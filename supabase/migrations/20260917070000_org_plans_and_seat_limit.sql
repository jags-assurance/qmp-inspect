-- Minimal billing/tariff foundation: which plan tier an organisation is on, and an optional seat
-- cap. Deliberately not a full billing system (no invoicing, no usage metering, no Stripe/payment
-- integration) — just the schema foundation a real billing feature would sit on top of later.
--
-- organization_plans is a separate table (one row per org, 1:1) rather than columns bolted onto
-- organizations, so plan/seat concerns stay isolated from the tenancy/branding concerns already on
-- that table, and so a future richer billing feature (plan history, trial dates, etc.) has
-- somewhere to grow without another organizations migration.

create table public.organization_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_tier text not null default 'professional'
    check (plan_tier in ('starter', 'professional', 'enterprise')),
  -- null = unlimited seats (no cap enforced by the trigger below).
  seat_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_plans_set_updated_at
  before update on public.organization_plans
  for each row execute function public.set_updated_at();

alter table public.organization_plans enable row level security;

create policy organization_plans_select on public.organization_plans
  for select using (public.has_org_access(organization_id));

create policy organization_plans_staff_write on public.organization_plans
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

-- Every organisation gets a sensible default plan row automatically, same pattern as
-- create_default_vault_folders() on public.projects (20260910010000_phase2_document_vault.sql):
-- a trigger for future inserts, plus a one-off backfill for every org that already exists.
create or replace function public.create_default_organization_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_plans (organization_id, plan_tier, seat_limit)
  values (new.id, 'professional', null);
  return new;
end;
$$;

create trigger organizations_create_default_plan
  after insert on public.organizations
  for each row execute function public.create_default_organization_plan();

insert into public.organization_plans (organization_id, plan_tier, seat_limit)
select o.id, 'professional', null
from public.organizations o
where not exists (
  select 1 from public.organization_plans p where p.organization_id = o.id
);

-- Seat-limit enforcement, modelled directly on the background_jobs per-org rate-limit trigger
-- (20260917000000_background_jobs_org_rate_limit.sql): a single BEFORE INSERT trigger on
-- access_grants rather than an app-layer check in lib/staff-access/actions.ts, for the same
-- reasons that migration gives — one enforcement point that also covers any future caller (a new
-- server action, an admin script), not just today's UI form.
--
-- Seat counting: distinct users already holding ANY access_grant scoped to this organisation
-- (scope_type='organization' or 'project') — access_grants_scope_shape already denormalizes
-- organization_id onto project-scoped grants (see 20260909210000_phase0_tenancy_schema.sql), so a
-- plain equality on organization_id covers both without a join through projects. A 'global' grant
-- (organization_id null) is not scoped to any one org and is intentionally excluded from every
-- org's seat count. If the inserting user already holds a grant for this org (e.g. adding a second,
-- narrower grant), they don't consume an extra seat.
--
-- SECURITY DEFINER: the count must see every grant for the org, not just what the inserting user's
-- own RLS SELECT visibility allows, otherwise the cap could be silently under-counted. search_path
-- is pinned for the usual SECURITY DEFINER hardening reason.

create or replace function public.enforce_access_grants_org_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat_limit int;
  v_user_already_counted boolean;
  v_existing_distinct_users int;
begin
  if new.organization_id is null then
    return new;
  end if;

  select seat_limit into v_seat_limit
  from public.organization_plans
  where organization_id = new.organization_id;

  if v_seat_limit is null then
    return new;
  end if;

  select exists (
    select 1 from public.access_grants ag
    where ag.organization_id = new.organization_id and ag.user_id = new.user_id
  ) into v_user_already_counted;

  if v_user_already_counted then
    return new;
  end if;

  select count(distinct ag.user_id) into v_existing_distinct_users
  from public.access_grants ag
  where ag.organization_id = new.organization_id;

  if v_existing_distinct_users + 1 > v_seat_limit then
    raise exception 'This organisation has reached its seat limit (%) — remove an existing access grant or raise the seat limit before adding another.', v_seat_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists access_grants_org_seat_limit on public.access_grants;
create trigger access_grants_org_seat_limit
  before insert on public.access_grants
  for each row execute function public.enforce_access_grants_org_seat_limit();
