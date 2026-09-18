-- Client-created ITPs (opt-in): lets a client-type project_party create and build out an ITP from
-- scratch, for projects where the client organisation runs (or co-runs) its own ITP program rather
-- than JAGS originating every one. Off by default — existing projects and behavior are completely
-- unchanged unless a JAGS Admin explicitly opts a project in (projects.allow_client_itp_creation),
-- the same shape as allow_client_execution (20260917060000_teams_and_delegation.sql).
--
-- Scope, deliberately conservative: a client party may create/edit an ITP and its sections/items/
-- intervention grid/checklist templates ONLY while that ITP is still 'draft'. The moment it moves to
-- 'under_review' (submitted) or beyond, only JAGS staff can touch it — same as the existing approval
-- workflow for any ITP, client-originated or not. Approval authority always stays with JAGS
-- regardless of who created the ITP; this migration only widens who can populate a draft.

alter table public.projects
  add column allow_client_itp_creation boolean not null default false;

-- SECURITY DEFINER + locked search_path, same reasoning as is_jags_staff/has_org_access
-- (20260909210100_phase0_rls_policies.sql): this runs inside RLS policies on the tables it queries.
-- itp_status is passed in by each policy (null where the caller has no single status to check, e.g.
-- an insert into a child table whose parent itp's status the policy already joined to) so this stays
-- a single, reusable check rather than one bespoke query per table.
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
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and p.allow_client_itp_creation
        and pp.party_type = 'client'
        and pp.is_active
        and pp.user_id = auth.uid()
    );
$$;

drop policy itps_write on public.itps;
create policy itps_write on public.itps
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = itps.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
    or public.is_client_itp_creator(itps.project_id, itps.status)
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = itps.project_id
        and public.is_jags_staff() and public.has_org_access(p.organization_id)
    )
    or public.is_client_itp_creator(itps.project_id, itps.status)
  );

drop policy itp_sections_write on public.itp_sections;
create policy itp_sections_write on public.itp_sections
  for all
  using (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_sections.itp_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  )
  with check (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_sections.itp_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  );

drop policy itp_items_write on public.itp_items;
create policy itp_items_write on public.itp_items
  for all
  using (
    exists (
      select 1 from public.itp_sections s
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where s.id = itp_items.section_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  )
  with check (
    exists (
      select 1 from public.itp_sections s
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where s.id = itp_items.section_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  );

drop policy activity_party_intervention_write on public.activity_party_intervention;
create policy activity_party_intervention_write on public.activity_party_intervention
  for all
  using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_party_intervention.itp_item_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  )
  with check (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_party_intervention.itp_item_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  );

drop policy checklist_templates_write on public.checklist_templates;
create policy checklist_templates_write on public.checklist_templates
  for all
  using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  )
  with check (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  );

drop policy checklist_items_write on public.checklist_items;
create policy checklist_items_write on public.checklist_items
  for all
  using (
    exists (
      select 1 from public.checklist_templates t
      join public.itp_items it on it.id = t.itp_item_id
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  )
  with check (
    exists (
      select 1 from public.checklist_templates t
      join public.itp_items it on it.id = t.itp_item_id
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where t.id = checklist_items.template_id
        and (
          (public.is_jags_staff() and public.has_org_access(p.organization_id))
          or public.is_client_itp_creator(p.id, i.status)
        )
    )
  );

grant execute on function public.is_client_itp_creator(uuid, text) to authenticated;
