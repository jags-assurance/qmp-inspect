-- Phase 0: identity & tenancy foundation.
-- organizations = tenants (a real client company, e.g. Meridian, Northgate).
-- public.users = one profile row per auth.users row (Supabase Auth owns auth.users itself).
-- access_grants = the "grant rows, not role columns" access model: a user's reach is defined by
-- explicit scoped grants (global / organization / project), not by a single role column, because
-- one user can plausibly need different standing in different scopes (JAGS staff span every
-- tenant; a subcontractor can work two competing clients' projects without either seeing the other).

create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  engagement_mode text not null default 'jags_led'
    check (engagement_mode in ('jags_led', 'co_branded', 'white_label')),
  -- Per-org opt-in required before any of that org's real content can be sent to the AI provider.
  -- JAGS-admin-only setting; enforced in the AI provider layer (lib/ai/provider.ts), not just here.
  ai_consent boolean not null default false,
  branding_logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  -- Distinguishes JAGS-internal staff (who can hold a "global" access_grants scope spanning every
  -- tenant) from every external party, who can only ever hold organization/project-scoped grants.
  is_jags_staff boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  scope_type text not null check (scope_type in ('global', 'organization', 'project')),
  organization_id uuid references public.organizations (id) on delete cascade,
  -- No FK yet: public.projects does not exist until the Phase 1 migration. The FK constraint is
  -- added there (alter table access_grants add constraint ... references projects).
  project_id uuid,
  -- Coarse role within that scope (admin/inspector/client_qa/contractor/viewer, etc.), used for
  -- UI/permission checks. Deliberately separate from project_parties.party_type (Phase 1), which
  -- is the inspection-workflow identity ("who acts as whom on this activity"), not platform access.
  role text not null,
  created_at timestamptz not null default now(),
  constraint access_grants_scope_shape check (
    (scope_type = 'global' and organization_id is null and project_id is null)
    or (scope_type = 'organization' and organization_id is not null and project_id is null)
    -- organization_id is denormalized onto project-scoped grants too (kept in sync by the
    -- project_parties insert flow in Phase 1) so has_org_access() can check it without a join.
    or (scope_type = 'project' and project_id is not null and organization_id is not null)
  )
);

-- A user may hold at most one grant per scope target (one global grant; one grant per org; one
-- grant per project). Plain UNIQUE can't express this because Postgres treats NULLs as distinct,
-- so partial indexes scoped to each scope_type are used instead.
create unique index access_grants_one_global_per_user
  on public.access_grants (user_id)
  where scope_type = 'global';

create unique index access_grants_one_per_org_per_user
  on public.access_grants (user_id, organization_id)
  where scope_type = 'organization';

create unique index access_grants_one_per_project_per_user
  on public.access_grants (user_id, project_id)
  where scope_type = 'project';

create index access_grants_organization_id_idx on public.access_grants (organization_id);

create table public.master_disciplines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_default boolean not null default true,
  is_active boolean not null default true,
  sort_order int not null default 0
);

insert into public.master_disciplines (code, name, sort_order) values
  ('CIV', 'Civil', 10),
  ('STR', 'Structural', 20),
  ('ARC', 'Architectural', 30),
  ('MEC', 'Mechanical', 40),
  ('ELE', 'Electrical', 50),
  ('INS', 'Instrumentation', 60),
  ('PIP', 'Piping', 70),
  ('HVAC', 'HVAC', 80),
  ('HSE', 'Health, Safety & Environment', 90);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Keeps public.users in sync with auth.users: every Supabase Auth sign-up gets a matching profile
-- row automatically. is_jags_staff defaults false and must be flipped explicitly by an existing
-- admin — it is never something a user can set about themselves via sign-up metadata being trusted
-- blindly in application code (this trigger reads it only because it runs as the DB, at sign-up
-- time, for the deliberate one-time bootstrap of the first staff account; ordinary invites go
-- through an admin-only server action instead, see Phase 0 auth flow).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, is_jags_staff)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_user_meta_data ->> 'is_jags_staff')::boolean, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
