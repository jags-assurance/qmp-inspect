-- Widens ITP creation (20260918000000_client_itp_creation.sql) beyond client-type parties: a
-- subcontractor or main_contractor party can also originate a draft ITP, opt-in per project via a
-- new flag separate from allow_client_itp_creation. Deliberately excludes tpi_lab and vendor — those
-- party types never execute checklists either (BASE_EXECUTING_PARTY_TYPES in
-- apps/web/lib/checklists/execution-parties.ts is subcontractor + main_contractor only, per R76
-- self-inspection), so extending creation rights to them would be a bigger, separate change than
-- "the party that already does the work can also originate the plan for it."
--
-- Same CEO ask this session already covered for clients ("hybrid... some created by their parties of
-- clients team, other external parties ITP generation") — this is the external-party half of it.

alter table public.projects
  add column allow_contractor_itp_creation boolean not null default false;

create or replace function public.is_client_itp_creator(target_project_id uuid, itp_status text default null)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (itp_status is null or itp_status = 'draft')
    and exists (
      select 1 from public.projects p
      join public.organizations o on o.id = p.organization_id
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and pp.is_active
        and pp.user_id = auth.uid()
        and (
          (pp.party_type = 'client' and (p.allow_client_itp_creation or o.engagement_scope = 'self_managed'))
          or (pp.party_type in ('subcontractor', 'main_contractor') and p.allow_contractor_itp_creation)
        )
    );
$$;
