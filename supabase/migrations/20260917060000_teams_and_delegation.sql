-- Adds four related pieces of the "teams / delegation / hybrid execution" gap:
--
-- 1. Teams: a JAGS-internal staff grouping (teams are always JAGS-internal — CEO: "JAGS teams of
--    some members assigned to some project" — so there is no organization_id here). A user can
--    belong to more than one team; team_project_assignments lets more than one team be responsible
--    for the same project (hybrid: some ITPs JAGS runs, some the client runs, different assigns).
-- 2. project_parties.onboarded_by: distinguishes a JAGS-onboarded party from a client-onboarded one.
-- 3. Sign-off delegation primitive: reassignSignoffPartyAction (app-layer, see lib/signoff/
--    actions.ts) reuses project_parties.user_id — no new schema needed for that beyond teams
--    existing, since "who may reassign" is a team-lead/admin question answered by the tables below.
-- 4. projects.allow_client_execution: per-project opt-in widening client-type parties into
--    checklist execution (apps/web/lib/checklists/actions.ts + the checklist page).

-- is_admin_staff(): SQL-level mirror of the app's isAdminStaff() (lib/auth/session.ts) — until now
-- that split (Admin vs Inspector) was enforced only in application code, never at the RLS layer, so
-- any JAGS staff row could see/write things intended to be Admin-only if a caller forgot the app-
-- level check. Needed now because teams/team_members/team_project_assignments RLS has to
-- distinguish "any staff" from "an Admin, specifically" at the database layer. A null staff_role
-- (legacy accounts) behaves as admin-equivalent, exactly matching isAdminStaff.
create or replace function public.is_admin_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_jags_staff and staff_role is distinct from 'inspector' from public.users where id = auth.uid()),
    false
  );
$$;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  is_team_lead boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members (user_id);

create table public.team_project_assignments (
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, project_id)
);

create index team_project_assignments_project_id_idx on public.team_project_assignments (project_id);

-- is_team_lead_of(team_id): whether the current user is a lead of that specific team. security
-- definer so it can be called from inside team_members'/team_project_assignments' own RLS policies
-- without recursive-policy evaluation issues (same reasoning as is_jags_staff()/has_org_access()).
create or replace function public.is_team_lead_of(target_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = target_team_id and user_id = auth.uid() and is_team_lead = true
  );
$$;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_project_assignments enable row level security;

-- teams: any JAGS staff can read (so a team lead/inspector on a team can see it); only an Admin
-- creates/renames/deletes a team itself — team leads manage MEMBERSHIP and PROJECT ASSIGNMENTS
-- (below), not the team row itself, matching "a team lead can only manage their own team's
-- membership and assignments" from the brief.
create policy teams_select on public.teams
  for select using (public.is_jags_staff());

create policy teams_admin_write on public.teams
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());

-- team_members: any JAGS staff can read. Write (add/remove members, promote/demote a lead) is
-- allowed for an Admin (head of all teams, per the CEO) OR a lead of THAT SPECIFIC team — never a
-- lead of a different team, enforced by scoping is_team_lead_of() to the row's own team_id in both
-- USING and WITH CHECK (so a lead can't repoint a membership row at another team either).
create policy team_members_select on public.team_members
  for select using (public.is_jags_staff());

create policy team_members_write on public.team_members
  for all
  using (public.is_admin_staff() or public.is_team_lead_of(team_id))
  with check (public.is_admin_staff() or public.is_team_lead_of(team_id));

-- team_project_assignments: same shape as team_members — an Admin, or a lead of the team being
-- assigned/unassigned, may manage which projects that team is responsible for.
create policy team_project_assignments_select on public.team_project_assignments
  for select using (public.is_jags_staff());

create policy team_project_assignments_write on public.team_project_assignments
  for all
  using (public.is_admin_staff() or public.is_team_lead_of(team_id))
  with check (public.is_admin_staff() or public.is_team_lead_of(team_id));

-- Onboarded-by: a JAGS-onboarded subcontractor and a client-onboarded one were previously
-- indistinguishable. Defaults to 'jags' (existing rows, and the existing add-party form's current
-- behaviour, are unchanged).
alter table public.project_parties
  add column onboarded_by text not null default 'jags' check (onboarded_by in ('jags', 'client'));

-- Client self-execution widening: per-project opt-in, default false so every existing project's
-- checklist-execution behaviour is unchanged. See apps/web/lib/checklists/execution-parties.ts for
-- where this is read.
alter table public.projects
  add column allow_client_execution boolean not null default false;
