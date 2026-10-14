-- M3 (documents audit): vault files (inspection-evidence bucket, path vault/<projectId>/...) were
-- readable and listable by ANY project member whatever the document's status, there was no delete
-- policy, and a failed row insert orphaned the uploaded object forever. Idempotent; no data changes.
--
--  READ / LIST  allowed for a user with project access AND one of:
--     - the matching vault_documents row is approved, or was approved and later superseded (revision
--       history stays visible, as in the UI); or
--     - the reader is JAGS staff, holds approve_vault_document for the project, is the uploader of the
--       row, or is a named approver of it; or
--     - the object has no row yet and the reader uploaded it (owner_id) - the upload flow reads its own
--       file back before/while the row is saved.
--    Drafts, for_review, rejected and plain-superseded files are therefore not fetchable by clients or
--    subcontractors by path or list. Server-side service-role access (worker, ZIP signing for staff,
--    transmittals) is unaffected; the Download-all ZIP already limits non-staff to approved rows.
--  DELETE       allowed for: admin staff with project access; the uploader of a document still in
--    for_review; or the uploader of an object that no row references (orphan cleanup).
--
-- Other buckets and inspection-evidence paths are untouched (their policies are separate).
-- Rollback: recreate inspection_evidence_vault_select from 20260916110000 (project access only), drop
-- inspection_evidence_vault_delete, drop the two helper functions and the storage_path index.

create index if not exists vault_documents_storage_path_idx on public.vault_documents (storage_path);

create or replace function public.can_read_vault_object(p_name text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.projects p
    where p.id::text = (string_to_array(p_name, '/'))[2]
      and (string_to_array(p_name, '/'))[1] = 'vault'
      and public.has_project_access(p.id, p.organization_id)
      and (
        public.is_jags_staff()
        or public.has_custom_permission(auth.uid(), 'approve_vault_document', p.id)
        or (p_owner is not null and p_owner = auth.uid()::text)
        or exists (
          select 1
          from public.vault_documents d
          join public.vault_folders f on f.id = d.folder_id
          where d.storage_path = p_name
            and f.project_id = p.id
            and (
              d.status = 'approved'
              or (d.status = 'superseded' and d.approved_at is not null)
              or d.uploaded_by = auth.uid()
              or exists (
                select 1 from public.vault_document_approvers a
                where a.document_id = d.id and a.approver_user_id = auth.uid()
              )
            )
        )
      )
  );
$$;

create or replace function public.can_delete_vault_object(p_name text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.projects p
    where p.id::text = (string_to_array(p_name, '/'))[2]
      and (string_to_array(p_name, '/'))[1] = 'vault'
      and public.has_project_access(p.id, p.organization_id)
      and (
        public.is_admin_staff()
        or (
          auth.uid() is not null
          and (
            -- still for review and uploaded by me
            exists (
              select 1 from public.vault_documents d
              join public.vault_folders f on f.id = d.folder_id
              where d.storage_path = p_name and f.project_id = p.id
                and d.status = 'for_review' and d.uploaded_by = auth.uid()
            )
            -- orphan: nothing references the object and I uploaded it
            or (
              p_owner is not null and p_owner = auth.uid()::text
              and not exists (select 1 from public.vault_documents d where d.storage_path = p_name)
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_read_vault_object(text, text) from public, anon;
revoke all on function public.can_delete_vault_object(text, text) from public, anon;
grant execute on function public.can_read_vault_object(text, text) to authenticated, service_role;
grant execute on function public.can_delete_vault_object(text, text) to authenticated, service_role;

drop policy if exists inspection_evidence_vault_select on storage.objects;
create policy inspection_evidence_vault_select on storage.objects for select using (
  bucket_id = 'inspection-evidence'
  and (storage.foldername(name))[1] = 'vault'
  and public.can_read_vault_object(name, owner_id::text)
);

drop policy if exists inspection_evidence_vault_delete on storage.objects;
create policy inspection_evidence_vault_delete on storage.objects for delete using (
  bucket_id = 'inspection-evidence'
  and (storage.foldername(name))[1] = 'vault'
  and public.can_delete_vault_object(name, owner_id::text)
);
