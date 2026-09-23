-- Gives client_team_project_assignments (until now write-only — a row inserted by "Assign to
-- project" on the Client Teams page and displayed back on that same admin page, read by nothing
-- else) a real database-level consequence, matching the app-layer check added to
-- reassignSignoffPartyAction (lib/signoff/actions.ts) via the new isClientTeamLeadForProject
-- helper (lib/client-teams/helpers.ts): a client team's own lead may reassign
-- project_parties.user_id, but only for a party_type='client' row, and only on a project their
-- team is actually assigned to.
--
-- Without this, that app-layer check alone would be a no-op: reassignSignoffPartyAction would
-- decide "allowed", skip its own error return, then the UPDATE it issues would be silently
-- filtered to zero rows by RLS (a JAGS team lead's equivalent reach comes from is_jags_staff() on
-- this same policy, which a client team lead has no path to at all — they need their own explicit
-- allowance here, not just the narrower app-layer check that assumes RLS already permits it).
drop policy project_parties_u on public.project_parties;
create policy project_parties_u on public.project_parties
  for update using (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or (
      party_type = 'client'
      and exists (
        select 1 from client_team_project_assignments cta
        where cta.project_id = project_parties.project_id
          and is_client_team_lead_of(cta.client_team_id)
      )
    )
  )
  with check (
    exists (select 1 from projects p where p.id = project_parties.project_id and is_jags_staff() and has_org_access(p.organization_id))
    or has_custom_permission((select auth.uid()), 'add_project_party', project_id)
    or has_custom_permission((select auth.uid()), 'reassign_project_party', project_id)
    or (
      party_type = 'client'
      and exists (
        select 1 from client_team_project_assignments cta
        where cta.project_id = project_parties.project_id
          and is_client_team_lead_of(cta.client_team_id)
      )
    )
  );
