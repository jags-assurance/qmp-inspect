-- Segregation of duties on vault approval (audit M11).
-- The person who uploaded the current revision cannot move it to 'approved'. The only exception is a
-- JAGS Admin who records an override reason (10+ chars) in vault_documents.approved_override_reason.
-- Transition-only: existing approved documents are untouched.
-- ROLLBACK: restore the previous vault_documents_guard_approval body (same function minus the
--   "segregation of duties" block), recreate vault_approve_document(uuid, uuid) from
--   20261123000300_vault_one_approved_per_reference.sql, then
--   alter table public.vault_documents drop column if exists approved_override_reason;

alter table public.vault_documents add column if not exists approved_override_reason text;

create or replace function public.vault_documents_guard_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_project_id uuid;
begin
  if auth.uid() is null then return new; end if;
  if (new.status in ('approved', 'rejected') and old.status is distinct from new.status)
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.rejected_by is distinct from old.rejected_by
     or new.rejected_at is distinct from old.rejected_at then
    select f.project_id into v_project_id from public.vault_folders f where f.id = new.folder_id;
    if not (
      public.is_admin_staff()
      or public.has_custom_permission(auth.uid(), 'approve_vault_document', v_project_id)
      or exists (select 1 from public.vault_document_approvers a where a.document_id = new.id and a.approver_user_id = auth.uid())
    ) then
      raise exception 'Only a JAGS Admin, a named approver or someone granted the approve permission can approve or reject a vault document' using errcode = '42501';
    end if;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved'
     and exists (select 1 from public.vault_document_approvers a where a.document_id = new.id) then
    if not exists (select 1 from public.vault_document_approvers a where a.document_id = new.id and a.approver_user_id = auth.uid()) then
      raise exception 'This document requires specific named approvers; only a named approver can complete its approval' using errcode = '42501';
    end if;
    if exists (select 1 from public.vault_document_approvers a where a.document_id = new.id and a.status is distinct from 'approved') then
      raise exception 'Every named approver must approve before this document is approved' using errcode = '42501';
    end if;
  end if;

  -- Segregation of duties: nobody approves the revision they uploaded (admin override needs a reason).
  if new.status = 'approved' and old.status is distinct from 'approved'
     and new.uploaded_by is not null and new.uploaded_by = auth.uid() then
    if not (public.is_admin_staff() and length(btrim(coalesce(new.approved_override_reason, ''))) >= 10) then
      raise exception 'You uploaded this document, so someone else must approve it (a JAGS Admin may override with a written reason of at least 10 characters)' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

-- Approve-and-retire RPC gains an optional override reason (stored with the approval).
drop function if exists public.vault_approve_document(uuid, uuid);
create or replace function public.vault_approve_document(p_document_id uuid, p_approved_by uuid, p_override_reason text default null)
returns boolean
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_doc record;
  v_updated int;
begin
  select id, folder_id, document_reference, status into v_doc
  from public.vault_documents where id = p_document_id for update;
  if not found or v_doc.status <> 'for_review' then
    return false;
  end if;

  if v_doc.document_reference is not null then
    perform pg_advisory_xact_lock(hashtext(v_doc.folder_id::text || v_doc.document_reference));
    update public.vault_documents d
       set status = 'superseded'
     where d.folder_id = v_doc.folder_id
       and d.document_reference = v_doc.document_reference
       and d.id <> v_doc.id
       and d.status <> 'superseded';
  end if;

  update public.vault_documents d
     set status = 'approved', approved_by = p_approved_by, approved_at = now(),
         approved_override_reason = nullif(btrim(coalesce(p_override_reason, '')), '')
   where d.id = v_doc.id and d.status = 'for_review';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Document is no longer awaiting review' using errcode = '40001';
  end if;

  if v_doc.document_reference is not null then
    update public.vault_documents d
       set superseded_by = v_doc.id
     where d.folder_id = v_doc.folder_id
       and d.document_reference = v_doc.document_reference
       and d.id <> v_doc.id
       and d.status = 'superseded'
       and d.superseded_by is null;
  end if;
  return true;
end;
$function$;

revoke all on function public.vault_approve_document(uuid, uuid, text) from public, anon;
grant execute on function public.vault_approve_document(uuid, uuid, text) to authenticated, service_role;
