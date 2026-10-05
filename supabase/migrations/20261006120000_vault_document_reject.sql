-- Vault reject step: a reviewer can send a document back ("rejected") with a reason, instead of the
-- only options being "leave it in review" or "supersede it with a new upload". A rejected document
-- is never linkable as evidence and is excluded from the download pack; uploading a new revision with
-- the same document reference replaces it.
alter table public.vault_documents drop constraint if exists vault_documents_status_check;
alter table public.vault_documents
  add constraint vault_documents_status_check check (status in ('for_review', 'approved', 'superseded', 'rejected'));
alter table public.vault_documents
  add column if not exists rejected_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

alter table public.vault_document_approvers drop constraint if exists vault_document_approvers_status_check;
alter table public.vault_document_approvers
  add constraint vault_document_approvers_status_check check (status in ('pending', 'approved', 'rejected'));

-- Rejecting needs the same authority as approving.
create or replace function public.vault_documents_guard_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.status in ('approved', 'rejected') and old.status is distinct from new.status)
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.rejected_by is distinct from old.rejected_by
     or new.rejected_at is distinct from old.rejected_at then
    select f.project_id into v_project_id from public.vault_folders f where f.id = new.folder_id;
    if not (
      public.is_admin_staff()
      or public.has_custom_permission(auth.uid(), 'approve_vault_document', v_project_id)
      or exists (
        select 1 from public.vault_document_approvers a
        where a.document_id = new.id and a.approver_user_id = auth.uid()
      )
    ) then
      raise exception 'Only a JAGS Admin, a named approver or someone granted the approve permission can approve or reject a vault document'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
