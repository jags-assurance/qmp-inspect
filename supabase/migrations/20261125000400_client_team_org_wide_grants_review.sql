-- B7: adding a client team member used to insert an ORGANISATION-scoped access grant, so the member
-- reached every project of the organisation instead of just the projects the team is assigned to. The app
-- now grants project-scoped access only (lib/client-teams/actions.ts); nothing here deletes or changes an
-- existing grant. This read-only view lists the grants an admin should review: client team members who
-- still hold an organisation-wide 'member' grant for their team's own organisation, with the projects the
-- team is actually assigned to. For each row an admin should decide whether to
--   * keep it (the person genuinely needs the whole organisation), or
--   * add project-scoped grants for the assigned projects (done automatically for new members / new
--     assignments) and then remove the organisation-wide grant by hand.
-- SECURITY INVOKER: RLS on access_grants / client_team_* still applies, so only people who can already see
-- those rows (JAGS admins, team leads of their own org) see anything. Idempotent.
create or replace view public.client_team_org_wide_grants_review
with (security_invoker = true) as
select
  ct.id as client_team_id,
  ct.name as client_team_name,
  ct.organization_id,
  ctm.user_id,
  g.id as access_grant_id,
  g.role as grant_role,
  coalesce(
    (select array_agg(a.project_id order by a.project_id)
       from public.client_team_project_assignments a
      where a.client_team_id = ct.id),
    '{}'::uuid[]
  ) as assigned_project_ids
from public.client_teams ct
join public.client_team_members ctm on ctm.client_team_id = ct.id
join public.access_grants g
  on g.user_id = ctm.user_id
 and g.scope_type = 'organization'
 and g.organization_id = ct.organization_id
 and g.role = 'member';

comment on view public.client_team_org_wide_grants_review is
  'B7 review list: client team members holding an organisation-wide member grant (the old behaviour) instead of project-scoped grants for the projects their team is assigned to.';

revoke all on public.client_team_org_wide_grants_review from public, anon;
grant select on public.client_team_org_wide_grants_review to authenticated;
