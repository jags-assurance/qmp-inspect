-- R46: pre-linked, per-client checklist sets. A checklist_library_templates row was previously
-- always global/shared across every client (Tier 1 of the two-tier pattern -- see
-- 20260922070000_checklist_library.sql's header). organization_id is nullable so that stays true
-- by default (null = global/shared, today's behavior, unchanged); setting it scopes that one
-- template to a single client organisation, so JAGS can maintain distinct checklist variants per
-- client without them colliding in the shared library.
alter table public.checklist_library_templates add column organization_id uuid references public.organizations (id);

create index checklist_library_templates_organization_id_idx on public.checklist_library_templates (organization_id);

-- The library stays staff-write-only (checklist_library_templates_staff_all /
-- checklist_library_items_staff_all, unchanged), but a template scoped to a client organisation
-- should also be readable by that org's own users -- same "global row visible to everyone, own-org
-- row visible to that org" shape as organizations_select (20260909210100_phase0_rls_policies.sql).
-- Postgres combines multiple permissive policies for the same command with OR, so this only adds
-- read access on top of staff's existing full access, never narrows it.
create policy checklist_library_templates_org_select on public.checklist_library_templates
  for select using (
    organization_id is null or public.has_org_access(organization_id)
  );

-- Items have no organization_id of their own -- visibility follows their parent template.
create policy checklist_library_items_org_select on public.checklist_library_items
  for select using (
    exists (
      select 1 from public.checklist_library_templates t
      where t.id = checklist_library_items.library_template_id
        and (t.organization_id is null or public.has_org_access(t.organization_id))
    )
  );
