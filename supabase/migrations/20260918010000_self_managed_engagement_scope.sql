-- Self-Managed / Platform-Only client tier: a distinct axis from engagement_mode (which only
-- controls branding on documents/numbering). engagement_scope controls who actually does the
-- inspection work:
--   'full_service'  (default) — JAGS runs the project; a client project can still opt individual
--                    projects into client execution/ITP-creation via the existing per-project flags
--                    (projects.allow_client_execution, projects.allow_client_itp_creation).
--   'self_managed'  — the client's own teams create/execute ITPs across EVERY one of their
--                    projects; JAGS only provides the platform + standard system monitoring. Rather
--                    than requiring an Admin to flip both per-project flags on every project this
--                    org ever creates, self_managed acts as an org-wide override in both
--                    is_client_itp_creator() and getExecutingPartyTypes() (app-side) — see those for
--                    the actual enforcement, this migration only adds the flag itself.

alter table public.organizations
  add column engagement_scope text not null default 'full_service'
    check (engagement_scope in ('full_service', 'self_managed'));

-- is_client_itp_creator (20260918000000_client_itp_creation.sql): a self_managed org's client party
-- can build a draft ITP regardless of the per-project allow_client_itp_creation flag.
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
        and (p.allow_client_itp_creation or o.engagement_scope = 'self_managed')
        and pp.party_type = 'client'
        and pp.is_active
        and pp.user_id = auth.uid()
    );
$$;
