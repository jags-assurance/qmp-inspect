-- Drawing / plan pin-drop markup (Round-table finding): field inspectors reviewing a P&ID /
-- drawing / plan document in the Document Vault (vault_documents) currently have no way to mark up
-- a specific location on that drawing -- NCRs, photos, and checklist items exist as rows with no
-- spatial reference to WHERE on a drawing they occurred.
--
-- x/y are fractional coordinates (0-1), not pixel-absolute, so a pin stays correctly placed
-- regardless of the size the drawing is rendered at (thumbnail vs. full viewer, different screen
-- widths, etc.) -- the client multiplies by the rendered width/height at draw time.
--
-- linked_entity_type/linked_entity_id is a polymorphic, application-level link (no DB FK), same
-- pattern as punch_list_items.source_ncr_id / source_standalone_assignment_id etc. -- a single FK
-- can't point at more than one table, and this app already models "optionally links to an NCR or a
-- photo" the same way elsewhere.
--
-- project_id is stored directly (denormalized off vault_documents -> vault_folders -> project_id)
-- rather than joined through, since RLS needs a fast, direct has_project_access check and every
-- other project-scoped table in this codebase carries its own project_id for the same reason.
--
-- RLS follows the CURRENT live pattern (has_project_access), matching
-- 20260917030000_add_personnel_certifications_register.sql and the other project-scoped tables.

create table public.drawing_markups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  vault_document_id uuid not null references public.vault_documents (id) on delete cascade,
  x numeric(6, 5) not null check (x >= 0 and x <= 1),
  y numeric(6, 5) not null check (y >= 0 and y <= 1),
  markup_type text not null default 'note' check (markup_type in ('note', 'ncr', 'photo')),
  -- Polymorphic, application-level reference only (see header) -- no FK, no cross-table constraint.
  linked_entity_id uuid,
  label text not null,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index drawing_markups_project_id_idx on public.drawing_markups (project_id);
create index drawing_markups_vault_document_id_idx on public.drawing_markups (vault_document_id);

alter table public.drawing_markups enable row level security;

create policy drawing_markups_select on public.drawing_markups for select using (
  exists (
    select 1 from public.projects p
    where p.id = drawing_markups.project_id and public.has_project_access(p.id, p.organization_id)
  )
);

create policy drawing_markups_write on public.drawing_markups for all using (
  exists (
    select 1 from public.projects p
    where p.id = drawing_markups.project_id and public.has_project_access(p.id, p.organization_id)
  )
) with check (
  exists (
    select 1 from public.projects p
    where p.id = drawing_markups.project_id and public.has_project_access(p.id, p.organization_id)
  )
);
