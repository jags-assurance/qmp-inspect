-- Phase 2: per-project document vault (Reqs: 11-folder document vault with revision tracking).
-- Every project gets a fixed set of 11 folders, auto-created the moment the project row exists —
-- done via an AFTER INSERT trigger on projects rather than in projects/actions.ts, so the folder
-- set can never drift out of sync with a project created through any other path (seed script,
-- future admin tool, etc.) the way an application-layer "also insert 11 rows" call could.
--
-- Revision tracking ("new upload of the same logical doc supersedes the old, old stays visible
-- marked superseded, never deleted") is implemented in the server action (lib/vault/actions.ts),
-- not here in SQL — see that file's header comment for why. This migration only carries the shape
-- that supports it: `status` includes 'superseded' and `superseded_by` points at the row that
-- replaced it; nothing in the DB enforces the transition, the app does.

create table public.vault_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  folder_key text not null check (folder_key in (
    'drawings',
    'specifications',
    'standards_codes',
    'material_submittals',
    'rfis',
    'method_statements',
    'itps_approved',
    'checklists_forms',
    'approvals_correspondence',
    'certificates',
    'general_reference'
  )),
  name text not null,
  created_at timestamptz not null default now(),
  unique (project_id, folder_key)
);

create index vault_folders_project_id_idx on public.vault_folders (project_id);

create table public.vault_documents (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.vault_folders (id) on delete cascade,
  title text not null,
  -- The logical document identity a new upload's "is this a new revision of X" check matches on.
  -- Nullable: not every document in the vault is a numbered/controlled document (e.g. a one-off
  -- piece of correspondence has nothing to key a revision chain off).
  document_reference text,
  revision text not null default '0',
  document_date date,
  -- Path in the "inspection-evidence" bucket: vault/{project_id}/{folder_key}/{filename}.
  storage_path text not null,
  file_size bigint,
  notes text,
  -- Auto-generated via the shared numbering engine (lib/numbering/generate.ts, doc_type
  -- 'vault_document') on every upload — distinct from document_reference, which is the optional,
  -- user-supplied revision-matching key. internal_reference is only ever populated when the
  -- owning organization's engagement_mode is 'white_label'.
  document_number text,
  internal_reference text,
  status text not null default 'for_review' check (status in ('for_review', 'approved', 'superseded')),
  -- Set by the app when a later upload supersedes this row; this row's own status is flipped to
  -- 'superseded' in the same operation. Never updated any other way.
  superseded_by uuid references public.vault_documents (id),
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index vault_documents_folder_id_idx on public.vault_documents (folder_id);
create index vault_documents_document_reference_idx on public.vault_documents (folder_id, document_reference);

-- Human-readable names for the 11 fixed folders, keyed by folder_key. Declared once here and
-- reused by the trigger function below.
create or replace function public.create_default_vault_folders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vault_folders (project_id, folder_key, name) values
    (new.id, 'drawings', 'Drawings'),
    (new.id, 'specifications', 'Specifications'),
    (new.id, 'standards_codes', 'Standards & Codes'),
    (new.id, 'material_submittals', 'Material Submittals'),
    (new.id, 'rfis', 'RFIs'),
    (new.id, 'method_statements', 'Method Statements'),
    (new.id, 'itps_approved', 'ITPs (Approved)'),
    (new.id, 'checklists_forms', 'Checklists & Forms'),
    (new.id, 'approvals_correspondence', 'Approvals & Correspondence'),
    (new.id, 'certificates', 'Certificates'),
    (new.id, 'general_reference', 'General Reference');
  return new;
end;
$$;

create trigger projects_create_default_vault_folders
  after insert on public.projects
  for each row execute function public.create_default_vault_folders();

alter table public.vault_folders enable row level security;
alter table public.vault_documents enable row level security;

create policy vault_folders_select on public.vault_folders
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = vault_folders.project_id and public.has_org_access(p.organization_id)
    )
  );

-- Folders are structural (the fixed 11, created only by the trigger above) — no user-facing
-- insert/update/delete policy is needed for ordinary use, so writes are staff-only as a backstop
-- (e.g. an admin fixing a mis-named folder), not exposed anywhere in the app today.
create policy vault_folders_staff_write on public.vault_folders
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy vault_documents_select on public.vault_documents
  for select using (
    exists (
      select 1 from public.vault_folders f
      join public.projects p on p.id = f.project_id
      where f.id = vault_documents.folder_id and public.has_org_access(p.organization_id)
    )
  );

-- Any project party can upload/manage standard project documents (per spec) — not staff-only,
-- same reasoning as ncrs_write / standalone_assignments_write: the boundary that matters is tenant
-- isolation via has_org_access, not who inside the tenant is acting. Insert and update are granted
-- (update covers the supersession flip done by the upload action); there is deliberately no delete
-- policy — documents are never deleted, only ever superseded.
create policy vault_documents_insert on public.vault_documents
  for insert
  with check (
    exists (
      select 1 from public.vault_folders f
      join public.projects p on p.id = f.project_id
      where f.id = vault_documents.folder_id and public.has_org_access(p.organization_id)
    )
  );

create policy vault_documents_update on public.vault_documents
  for update using (
    exists (
      select 1 from public.vault_folders f
      join public.projects p on p.id = f.project_id
      where f.id = vault_documents.folder_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.vault_folders f
      join public.projects p on p.id = f.project_id
      where f.id = vault_documents.folder_id and public.has_org_access(p.organization_id)
    )
  );

-- Additional storage.objects policies for the vault's own path shape, on top of the existing ones
-- in 20260909280000_phase1_storage_policies.sql (left untouched): vault/{project_id}/{folder_key}/
-- {filename}, in the same "inspection-evidence" bucket the rest of the app already uploads
-- evidence/documents to. Same has_org_access-via-project-join pattern as the existing policies.
create policy inspection_evidence_vault_select on storage.objects
  for select using (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(name))[1] = 'vault'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2]
        and public.has_org_access(p.organization_id)
    )
  );

create policy inspection_evidence_vault_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(name))[1] = 'vault'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2]
        and public.has_org_access(p.organization_id)
    )
  );
