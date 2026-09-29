-- Two real gaps confirmed by an audit: (1) the Vault's 12 folder categories are a hardcoded DB check
-- constraint + trigger with no way for a project to add its own category, and (2) approval is a
-- single boolean flip by whoever clicks first — there's no way to require several specific people to
-- independently agree before a document counts as approved.

-- ===== 1. Custom categories =====
-- A project can add its own folder on top of the fixed 12 — is_custom bypasses the enum check for
-- exactly those rows, so the existing 12 stay exactly as strict as before.
alter table public.vault_folders add column if not exists is_custom boolean not null default false;

alter table public.vault_folders drop constraint if exists vault_folders_folder_key_check;
alter table public.vault_folders add constraint vault_folders_folder_key_check
  check (
    is_custom or folder_key in (
      'drawings', 'specifications', 'standards_codes', 'material_submittals', 'rfis',
      'method_statements', 'itps_approved', 'checklists_forms', 'approvals_correspondence',
      'certificates', 'general_reference', 'test_reports'
    )
  );

-- Custom folders are written by the same app-layer action as everything else project-scoped —
-- widen the existing staff-only write policy to also allow a self-managed/client-managed org's own
-- admin (matching every other "client manages its own project" widening in this app), never a plain
-- full_service client.
drop policy if exists vault_folders_staff_write on public.vault_folders;
create policy vault_folders_staff_write on public.vault_folders
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = vault_folders.project_id
        and (
          public.is_jags_staff()
          or exists (
            select 1 from public.organizations o
            where o.id = p.organization_id and o.engagement_scope in ('self_managed', 'client_managed')
          )
        )
        and public.has_org_access(p.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = vault_folders.project_id
        and (
          public.is_jags_staff()
          or exists (
            select 1 from public.organizations o
            where o.id = p.organization_id and o.engagement_scope in ('self_managed', 'client_managed')
          )
        )
        and public.has_org_access(p.organization_id)
    )
  );

-- ===== 2. Multi-approver =====
-- One row per person required to agree on ONE document — set at upload time (optional; a document
-- with no rows here keeps today's exact single-click approveVaultDocumentAction behaviour). Once
-- every row for a document is 'approved', the document itself flips to approved (same
-- vault_documents.status/approved_by/approved_at columns, so every existing reader of that status
-- needs no change).
create table public.vault_document_approvers (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.vault_documents (id) on delete cascade,
  approver_user_id uuid not null references public.users (id),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, approver_user_id)
);

create index vault_document_approvers_document_idx on public.vault_document_approvers (document_id);

alter table public.vault_document_approvers enable row level security;

create policy vault_document_approvers_select on public.vault_document_approvers
  for select using (
    exists (
      select 1 from public.vault_documents d
      join public.vault_folders f on f.id = d.folder_id
      join public.projects p on p.id = f.project_id
      where d.id = vault_document_approvers.document_id and public.has_org_access(p.organization_id)
    )
  );

-- Setting up WHO must approve is staff-only (same authority as approve_vault_document itself) —
-- configuring the requirement is as sensitive as approving. Updating your OWN row (marking your step
-- approved) is separately allowed for the named approver.
create policy vault_document_approvers_insert on public.vault_document_approvers
  for insert with check (
    public.is_jags_staff()
    and exists (
      select 1 from public.vault_documents d
      join public.vault_folders f on f.id = d.folder_id
      join public.projects p on p.id = f.project_id
      where d.id = vault_document_approvers.document_id and public.has_org_access(p.organization_id)
    )
  );

create policy vault_document_approvers_update on public.vault_document_approvers
  for update using (
    public.is_jags_staff() or approver_user_id = auth.uid()
  ) with check (
    public.is_jags_staff() or approver_user_id = auth.uid()
  );

create policy vault_document_approvers_delete on public.vault_document_approvers
  for delete using (public.is_jags_staff());
