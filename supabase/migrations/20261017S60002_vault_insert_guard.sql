-- Vault insert guard: vault_documents_insert only checks project access, so a member could insert a
-- row already status='approved' (self-approving a controlled document) or point storage_path at the
-- generated-documents bucket. The existing vault_documents_guard_approval trigger is UPDATE-only.
-- Non-system callers (auth.uid() not null, not service_role) are normalised here. The worker
-- (vaultAutoFile, service_role) and the web service client are system callers and unaffected.
-- Supersede/void updates need no exemption: guard_approval only gates status -> approved/rejected and
-- approved_*/rejected_* changes, and guard_immutable already allows approved -> superseded.
-- Idempotent.
create or replace function public.vault_documents_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  -- Generated documents are filed only by the worker; users cannot reference that bucket.
  if new.storage_path like 'generated-documents:%'
     and (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path) then
    raise exception 'Generated documents can only be filed by the system' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select f.project_id into v_project_id from public.vault_folders f where f.id = new.folder_id;
    -- Same permission test as vault_documents_guard_approval (a named approver cannot exist yet).
    if not (
      public.is_admin_staff()
      or public.has_custom_permission(auth.uid(), 'approve_vault_document', v_project_id)
    ) then
      new.status := 'for_review';
      new.approved_by := null;
      new.approved_at := null;
      new.rejected_by := null;
      new.rejected_at := null;
      new.rejection_reason := null;
      new.superseded_by := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.vault_documents_guard_insert() from public, anon, authenticated;

drop trigger if exists vault_documents_guard_insert on public.vault_documents;
create trigger vault_documents_guard_insert
  before insert or update of storage_path on public.vault_documents
  for each row execute function public.vault_documents_guard_insert();
