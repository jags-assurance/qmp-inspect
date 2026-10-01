-- Inspection photo evidence was device-upload only, with no way to attach a controlled Document
-- Vault file (a prior cert, a client-supplied drawing) as evidence of an inspection — mirrors
-- itp_item_evidence_documents / standalone_assignment_evidence_documents' exact pattern (upload to
-- the project's Vault first, link here) rather than inventing a second upload path.
create table public.inspection_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  -- Nullable: a document can evidence the inspection as a whole (null, same convention as
  -- inspection_photos.checklist_item_id) or one specific checklist item.
  checklist_item_id uuid references public.checklist_items (id) on delete cascade,
  vault_document_id uuid not null references public.vault_documents (id) on delete cascade,
  linked_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (inspection_record_id, vault_document_id)
);

create index inspection_evidence_documents_record_idx on public.inspection_evidence_documents (inspection_record_id);

alter table public.inspection_evidence_documents enable row level security;

-- Same boundary as inspection_photos/checklist_responses: RLS enforces tenant/project access only;
-- the finer "only the party assigned to execute this activity may write" rule is enforced at the
-- application layer (canExecuteItpItem), same split every sibling evidence table already uses.
create policy inspection_evidence_documents_select on public.inspection_evidence_documents
  for select using (
    exists (
      select 1
      from inspection_records ir
      join projects p on p.id = ir.project_id
      where ir.id = inspection_evidence_documents.inspection_record_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy inspection_evidence_documents_write_i on public.inspection_evidence_documents
  for insert with check (
    exists (
      select 1
      from inspection_records ir
      join projects p on p.id = ir.project_id
      where ir.id = inspection_evidence_documents.inspection_record_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy inspection_evidence_documents_write_d on public.inspection_evidence_documents
  for delete using (
    exists (
      select 1
      from inspection_records ir
      join projects p on p.id = ir.project_id
      where ir.id = inspection_evidence_documents.inspection_record_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );
