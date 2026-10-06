-- Document control: once a vault document is approved (or superseded) the controlled file and its
-- identity must never change in place. A new revision is a NEW row. The existing approval guard only
-- protects status/approved_* columns; vault_documents_update still let any project member rewrite
-- storage_path, revision, document_reference or document_number of an APPROVED document (silently
-- swapping the controlled file). Service-role / worker writes (auth.uid() is null) are unaffected.
create or replace function public.vault_documents_guard_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if old.status in ('approved', 'superseded') and (
       new.storage_path is distinct from old.storage_path
    or new.revision is distinct from old.revision
    or new.document_reference is distinct from old.document_reference
    or new.document_number is distinct from old.document_number
    or new.folder_id is distinct from old.folder_id
    or new.file_size is distinct from old.file_size
  ) then
    raise exception 'An approved or superseded document is controlled: upload a new revision instead of changing it'
      using errcode = '42501';
  end if;
  -- A document that left review cannot be re-opened or have its status rewritten except the one
  -- legitimate transition approved -> superseded (done when its replacement is approved).
  if old.status = 'superseded' and new.status is distinct from old.status then
    raise exception 'A superseded document cannot change status' using errcode = '42501';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'superseded') then
    raise exception 'An approved document can only be superseded by a newer approved revision' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists vault_documents_guard_immutable on public.vault_documents;
create trigger vault_documents_guard_immutable
  before update on public.vault_documents
  for each row execute function public.vault_documents_guard_immutable();

-- Documents are never hard-deleted by members (audit/evidence integrity): make that explicit by
-- ensuring there is no delete policy for end users on vault_documents.
drop policy if exists vault_documents_delete on public.vault_documents;

-- Fast "my pending approvals" and project-wide pending queue lookups.
create index if not exists vault_documents_status_folder_idx on public.vault_documents (folder_id, status);
create index if not exists audit_log_vault_entity_idx on public.audit_log (entity_id) where entity_type = 'vault_document';
