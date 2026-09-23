-- Standalone assignments had NO document/evidence attachment mechanism at all — only photos (raw
-- Storage uploads, no vault linkage) and signatures. Mirrors the same fix just built for ITP items
-- (itp_item_evidence_documents, 20260929040000_itp_item_evidence_execution.sql): a many-to-many
-- link to vault_documents rather than a second upload UI/storage path — upload to the project's
-- Vault first (where it gets a real document number/revision history), then link it here.
create table public.standalone_assignment_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.standalone_assignments (id) on delete cascade,
  vault_document_id uuid not null references public.vault_documents (id) on delete cascade,
  linked_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (assignment_id, vault_document_id)
);

create index standalone_assignment_evidence_documents_assignment_id_idx
  on public.standalone_assignment_evidence_documents (assignment_id);

alter table public.standalone_assignment_evidence_documents enable row level security;

-- Standalone assignments are staff-run end to end (every action in lib/standalone/actions.ts
-- already rejects a non-staff caller) — select stays at the tenant-access boundary (same as the
-- assignment's own other child tables), write is staff-only, matching that established pattern
-- exactly rather than inventing a party-execution rule this feature never had.
create policy standalone_assignment_evidence_documents_select on public.standalone_assignment_evidence_documents
  for select using (
    exists (
      select 1
      from standalone_assignments a
      join projects p on p.id = a.project_id
      where a.id = standalone_assignment_evidence_documents.assignment_id
        and has_project_access(p.id, p.organization_id)
    )
  );

create policy standalone_assignment_evidence_documents_write_i on public.standalone_assignment_evidence_documents
  for insert with check (is_jags_staff());

create policy standalone_assignment_evidence_documents_write_d on public.standalone_assignment_evidence_documents
  for delete using (is_jags_staff());
