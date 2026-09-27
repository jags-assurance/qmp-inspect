-- Two real gaps found live: (1) the Inspection Report PDF's Document Control "REV" cell was a static
-- hardcoded "0" — every re-inspection attempt on the same activity (INSP-1, INSP-2 after a fail,
-- INSP-3...) rendered the identical "REV 0", giving no visual signal a document had been superseded,
-- unlike the ITP PDF's own real `itps.revision`. (2) the "Start inspection" location field was
-- free-text only, with no org/project-configurable preset list — a real field-inspection app usually
-- has a fixed set of site zones/blocks inspectors pick from, not retype every time.

-- ===== 1. Per-activity revision counter on inspection_records =====
-- Deliberately scoped to itp_item_id, NOT the ITP-wide inspection: N sequence (inspection:${itpNumber}
-- in startInspectionAction, shared across every activity on the ITP) — a re-inspection's "revision"
-- should count attempts on THIS activity specifically, the same way a document's revision counts
-- supersessions of that one document, not of the whole project.
alter table public.inspection_records
  add column if not exists revision int not null default 0;

comment on column public.inspection_records.revision is
  'Attempt count for THIS activity (itp_item_id) at the moment this record was created — 0 for the first inspection, 1 for the next attempt on the same activity, etc. Drives the Inspection Report PDF''s Document Control "REV" field.';

-- ===== 2. Org/project-configurable inspection location presets =====
-- Same "org default, project overrides" shape as notice_period_configs/numbering_configs: a null
-- project_id row is the organisation-wide default list; a project_id row scopes presets to just that
-- project. Read as the union (project rows + org rows) by the app layer, same precedence idea used
-- elsewhere in this app.
create table public.inspection_location_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, project_id, name)
);

create index inspection_location_presets_org_idx on public.inspection_location_presets (organization_id);
create index inspection_location_presets_project_idx on public.inspection_location_presets (project_id);

alter table public.inspection_location_presets enable row level security;

create policy inspection_location_presets_select on public.inspection_location_presets
  for select using (public.has_org_access(organization_id));

-- Same authority bar as numbering_configs_self_managed_write (20260919050000): a JAGS Admin always
-- can; a self_managed or client_managed org's own admin can manage its own project's presets too —
-- this is exactly the kind of low-stakes operational config (not an approval/acceptance authority)
-- those two tiers are meant to self-serve.
create policy inspection_location_presets_write on public.inspection_location_presets
  for all using (
    public.is_jags_staff()
    or (
      exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
      and public.has_org_access(organization_id)
    )
  ) with check (
    public.is_jags_staff()
    or (
      exists (select 1 from public.organizations o where o.id = organization_id and o.engagement_scope in ('self_managed', 'client_managed'))
      and public.has_org_access(organization_id)
    )
  );
