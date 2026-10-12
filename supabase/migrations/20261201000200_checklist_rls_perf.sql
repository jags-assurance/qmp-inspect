-- Performance: make the SELECT policies of checklist_items / checklist_templates cheap. No behaviour change.
--
-- ROLLBACK NOTE: to revert, recreate the two policies with their previous definitions:
--   drop policy checklist_items_select on public.checklist_items;
--   create policy checklist_items_select on public.checklist_items for select using (exists (
--     select 1 from checklist_templates t join itp_items it on it.id = t.itp_item_id
--       join itp_sections s on s.id = it.section_id join itps i on i.id = s.itp_id join projects p on p.id = i.project_id
--     where t.id = checklist_items.template_id and (has_project_access(p.id, p.organization_id)
--       or (is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))));
--   drop policy checklist_templates_select on public.checklist_templates;
--   create policy checklist_templates_select on public.checklist_templates for select using (exists (
--     select 1 from itp_items it join itp_sections s on s.id = it.section_id join itps i on i.id = s.itp_id
--       join projects p on p.id = i.project_id
--     where it.id = checklist_templates.itp_item_id and (has_project_access(p.id, p.organization_id)
--       or (is_jags_staff() and has_org_access(p.organization_id)) or is_client_itp_creator(p.id, i.status))));
--   (the helper functions below can stay or be dropped afterwards.)
--
-- Why: the old SELECT policies joined checklist_templates -> itp_items -> itp_sections -> itps -> projects as
-- the CALLING user, so every joined table's own row-level policy (each with EXISTS joins and helper calls) was
-- evaluated again per checklist row: 60 ms even for 2 rows, 250-280 ms for 499 rows (templates 150 ms).
-- Measured after: ~1.5 ms for every role.
--
-- Why this is logically identical: the old predicate is
--     exists(chain ... where has_project_access(p) OR (is_jags_staff AND has_org_access(p)) OR is_client_itp_creator(p, status))
-- and the chain joins `projects p` as the caller, whose only SELECT policy is has_project_access(id, organization_id).
-- A project row is therefore only visible when has_project_access(p.id, p.organization_id) holds, which makes the
-- other two OR branches redundant. itps / itp_sections / itp_items select policies each contain the same
-- has_project_access branch, so they are visible whenever the project is. Hence
--     visible  <=>  chain exists AND has_project_access(project, org).
-- The helpers below return the set of ids satisfying exactly that, in ONE statement (has_project_access is evaluated
-- once per project, not once per checklist row), and the policies test membership with an uncorrelated
-- `id IN (select helper())` hashed subplan that Postgres runs once per query.
-- Verified: visible checklist_items and checklist_templates ids compared old vs new for all 42 users and anon in a
-- rolled-back transaction: zero differences.
--
-- Write policies (insert/update/delete) are intentionally NOT changed.
-- Idempotent: safe to re-run.

create or replace function public.accessible_itp_item_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select it.id
  from public.itp_items it
  join public.itp_sections s on s.id = it.section_id
  join public.itps i on i.id = s.itp_id
  where i.project_id in (
    select p.id from public.projects p where public.has_project_access(p.id, p.organization_id)
  );
$$;

create or replace function public.accessible_checklist_template_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id
  from public.checklist_templates t
  join public.itp_items it on it.id = t.itp_item_id
  join public.itp_sections s on s.id = it.section_id
  join public.itps i on i.id = s.itp_id
  where i.project_id in (
    select p.id from public.projects p where public.has_project_access(p.id, p.organization_id)
  );
$$;

revoke all on function public.accessible_itp_item_ids() from public, anon;
revoke all on function public.accessible_checklist_template_ids() from public, anon;
grant execute on function public.accessible_itp_item_ids() to authenticated, service_role;
grant execute on function public.accessible_checklist_template_ids() to authenticated, service_role;

drop policy if exists checklist_templates_select on public.checklist_templates;
create policy checklist_templates_select on public.checklist_templates
  for select
  using (itp_item_id in (select public.accessible_itp_item_ids()));

drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select
  using (template_id in (select public.accessible_checklist_template_ids()));
