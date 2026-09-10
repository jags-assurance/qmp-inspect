-- Phase 1: projects and project parties — the first entities inside a tenant.
-- project_parties is the project-level "who acts as whom on this project" layer (used by the
-- multi-party sign-off chain in a later Phase 1 migration), distinct from access_grants, which is
-- the platform-level "can this user reach this project at all" layer.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_number text not null,
  name text not null,
  contract_number text,
  site_location text,
  country text,
  start_date date,
  end_date date,
  status text not null default 'active'
    check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_number)
);

create index projects_organization_id_idx on public.projects (organization_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Deferred from Phase 0 (public.projects didn't exist yet when access_grants was created).
alter table public.access_grants
  add constraint access_grants_project_id_fkey
  foreign key (project_id) references public.projects (id) on delete cascade;

create table public.project_parties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  party_type text not null
    check (party_type in ('subcontractor', 'main_contractor', 'tpi_lab', 'vendor', 'client', 'jags')),
  name text not null,
  contact_name text,
  contact_email text,
  discipline_id uuid references public.master_disciplines (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index project_parties_project_id_idx on public.project_parties (project_id);

alter table public.projects enable row level security;
alter table public.project_parties enable row level security;

create policy projects_select on public.projects
  for select using (public.has_org_access(organization_id));

-- Only JAGS staff create/edit projects (matches Reqs: JAGS admin/staff set up projects/clients).
create policy projects_staff_write on public.projects
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy project_parties_select on public.project_parties
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_parties.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy project_parties_staff_write on public.project_parties
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());
