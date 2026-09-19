-- Client Teams: a client organization's own analogue of JAGS-internal `teams`
-- (20260917060000_teams_and_delegation.sql), letting a client group its OWN people
-- (project_parties/users who have access to that org) into named teams for their own internal
-- organization of who's responsible for what. Deliberately a SEPARATE set of tables, not a widening
-- of `teams` with an organization_id — `teams` is JAGS-internal-only by original design (CEO:
-- "JAGS teams of some members assigned to some project") and conflating the two concepts would
-- blur "JAGS's own staff grouping" with "a client's own people grouping". Structurally parallel:
-- client_teams / client_team_members / client_team_project_assignments mirror
-- teams / team_members / team_project_assignments shape-for-shape, but organization-scoped.

create table public.client_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index client_teams_organization_id_idx on public.client_teams (organization_id);

create table public.client_team_members (
  client_team_id uuid not null references public.client_teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  is_team_lead boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (client_team_id, user_id)
);

create index client_team_members_user_id_idx on public.client_team_members (user_id);

create table public.client_team_project_assignments (
  client_team_id uuid not null references public.client_teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_team_id, project_id)
);

create index client_team_project_assignments_project_id_idx on public.client_team_project_assignments (project_id);

-- A client team may only be assigned to a project belonging to the SAME organization as the team
-- itself (a client team is scoped to its own org's projects, never another org's) — enforced with a
-- trigger rather than a cross-table check constraint (Postgres check constraints can't reference
-- another table).
create or replace function public.check_client_team_project_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.client_teams ct
    join public.projects p on p.id = new.project_id
    where ct.id = new.client_team_id
      and p.organization_id = ct.organization_id
  ) then
    raise exception 'A client team can only be assigned to a project belonging to its own organization.';
  end if;
  return new;
end;
$$;

create trigger client_team_project_assignments_same_org
  before insert or update on public.client_team_project_assignments
  for each row execute function public.check_client_team_project_same_org();

-- is_client_team_lead_of(client_team_id): self-referential analogue of is_team_lead_of() for JAGS
-- teams — whether the current user is a lead of that specific client team. security definer so it
-- can be called from inside client_team_members'/client_team_project_assignments' own RLS policies
-- without recursive-policy evaluation issues.
create or replace function public.is_client_team_lead_of(target_client_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.client_team_members
    where client_team_id = target_client_team_id and user_id = auth.uid() and is_team_lead = true
  );
$$;

-- Bootstrap: a self_managed org has no existing team (and so no existing lead) the very first time
-- it wants to create one — same chicken-and-egg problem the self-managed project-creation RLS
-- solved (20260919010000_self_managed_project_creation.sql: org-access + engagement_scope check for
-- the create case). Mirrors that pattern here for the FIRST client_teams row in an org: any user
-- with has_org_access to a self_managed org may create a team for it, but only while that org has
-- no team yet — once it has one, creating another (or managing any existing one) requires being an
-- Admin or a lead of that specific team, same as ongoing JAGS-team management. A full_service client
-- never gets this bootstrap path — their teams (if any) are set up by JAGS during onboarding.
create or replace function public.can_bootstrap_client_team(target_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.has_org_access(target_org_id)
    and exists (
      select 1 from public.organizations o
      where o.id = target_org_id and o.engagement_scope = 'self_managed'
    )
    and not exists (
      select 1 from public.client_teams ct where ct.organization_id = target_org_id
    );
$$;

alter table public.client_teams enable row level security;
alter table public.client_team_members enable row level security;
alter table public.client_team_project_assignments enable row level security;

-- client_teams: readable by anyone with has_org_access to that organization (JAGS staff already
-- have has_org_access everywhere via their own access_grants, so an Admin can read across orgs the
-- same way other org-scoped admin pages work). Write (create) is an Admin, OR a lead of that
-- specific team (renaming an existing team, matching "a team lead can manage their own team" from
-- the JAGS-side teams model), OR — for the very first team in a self_managed org — the bootstrap
-- path above.
create policy client_teams_select on public.client_teams
  for select using (public.is_admin_staff() or public.has_org_access(organization_id));

create policy client_teams_write on public.client_teams
  for all
  using (public.is_admin_staff() or public.is_client_team_lead_of(id))
  with check (
    public.is_admin_staff()
    or public.is_client_team_lead_of(id)
    or public.can_bootstrap_client_team(organization_id)
  );

-- client_team_members: readable by anyone with org access to the parent team's organization. Write
-- (add/remove members, promote/demote a lead) is an Admin, a lead of THAT SPECIFIC team, or — while
-- bootstrapping a self_managed org's very first team — anyone with org access, so the team's creator
-- can add themselves (or anyone else) as the first member/lead without already being a lead of a
-- team that doesn't exist yet.
create policy client_team_members_select on public.client_team_members
  for select using (
    public.is_admin_staff()
    or exists (
      select 1 from public.client_teams ct
      where ct.id = client_team_id and public.has_org_access(ct.organization_id)
    )
  );

create policy client_team_members_write on public.client_team_members
  for all
  using (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
  )
  with check (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
    or exists (
      select 1 from public.client_teams ct
      where ct.id = client_team_id and public.can_bootstrap_client_team(ct.organization_id)
    )
  );

-- client_team_project_assignments: same shape as client_team_members.
create policy client_team_project_assignments_select on public.client_team_project_assignments
  for select using (
    public.is_admin_staff()
    or exists (
      select 1 from public.client_teams ct
      where ct.id = client_team_id and public.has_org_access(ct.organization_id)
    )
  );

create policy client_team_project_assignments_write on public.client_team_project_assignments
  for all
  using (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
  )
  with check (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
    or exists (
      select 1 from public.client_teams ct
      where ct.id = client_team_id and public.can_bootstrap_client_team(ct.organization_id)
    )
  );
