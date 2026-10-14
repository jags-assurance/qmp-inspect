-- M7 (documents audit): retention 'dispose_approved' triggered nothing. Adds a manual, admin-only
-- completion step: after a disposal is approved, an Admin marks the document disposed (who/when are
-- recorded). The application removes the stored file only after a typed confirmation; nothing is ever
-- automatic and the vault_documents row is kept as the audit record. Idempotent.
-- Rollback: drop function mark_retention_disposed(uuid); alter table vault_retention_flags drop column
-- disposed_at, drop column disposed_by.

alter table public.vault_retention_flags add column if not exists disposed_at timestamptz;
alter table public.vault_retention_flags add column if not exists disposed_by uuid references public.users (id) on delete set null;

create or replace function public.mark_retention_disposed(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flag public.vault_retention_flags%rowtype;
begin
  if auth.uid() is null or not public.is_admin_staff() then
    raise exception 'Only a JAGS Admin can mark a document disposed';
  end if;
  select * into v_flag from public.vault_retention_flags where document_id = p_document_id for update;
  if not found then
    raise exception 'This document is not flagged for retention review';
  end if;
  if not public.has_project_access(v_flag.project_id, v_flag.organization_id) then
    raise exception 'No access to this project';
  end if;
  if v_flag.review_outcome is distinct from 'dispose_approved' then
    raise exception 'Disposal has not been approved for this document';
  end if;
  if v_flag.disposed_at is not null then
    return;
  end if;
  update public.vault_retention_flags set disposed_at = now(), disposed_by = auth.uid() where document_id = p_document_id;
end;
$$;

revoke all on function public.mark_retention_disposed(uuid) from public, anon;
grant execute on function public.mark_retention_disposed(uuid) to authenticated, service_role;
