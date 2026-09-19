-- Fixes a chicken-and-egg gap in the client_teams bootstrap RLS (20260919020000_client_teams.sql):
-- can_bootstrap_client_team(org_id) checks "this org has no client_teams row yet", which is exactly
-- right for the CREATE-the-first-team case, but once that team row exists (even with zero members)
-- the same function immediately returns false for that org — so the very person who just created the
-- team could never add themselves (or anyone else) as its first member/lead, and could never assign
-- it to a project either. Splits the bootstrap check in two:
--   * can_bootstrap_client_team(org_id)          — unchanged: gates INSERT of the first client_teams
--     row for a self_managed org the caller has access to.
--   * can_bootstrap_client_team_members(team_id) — NEW: gates client_team_members /
--     client_team_project_assignments writes on a team that has has_org_access, belongs to a
--     self_managed org, and does not yet have ANY team lead — i.e. "this team hasn't been claimed by
--     a lead yet", which is true right after creation and false as soon as a lead exists, at which
--     point ongoing management reverts to the normal admin-or-lead-of-this-team rule.
create or replace function public.can_bootstrap_client_team_members(target_client_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1
      from public.client_teams ct
      join public.organizations o on o.id = ct.organization_id
      where ct.id = target_client_team_id
        and o.engagement_scope = 'self_managed'
        and public.has_org_access(ct.organization_id)
    )
    and not exists (
      select 1 from public.client_team_members ctm
      where ctm.client_team_id = target_client_team_id and ctm.is_team_lead = true
    );
$$;

drop policy client_team_members_write on public.client_team_members;
create policy client_team_members_write on public.client_team_members
  for all
  using (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
  )
  with check (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
    or public.can_bootstrap_client_team_members(client_team_id)
  );

drop policy client_team_project_assignments_write on public.client_team_project_assignments;
create policy client_team_project_assignments_write on public.client_team_project_assignments
  for all
  using (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
  )
  with check (
    public.is_admin_staff()
    or public.is_client_team_lead_of(client_team_id)
    or public.can_bootstrap_client_team_members(client_team_id)
  );
