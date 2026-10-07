-- Stage 6 / 7 hardening (agent A). Idempotent; no data changes.
--
--  S6-02  Any project member could PATCH an approved controlled document (IRN, certificate, Data
--         Book) to 'superseded' and hide it. approved -> superseded is now allowed only for JAGS
--         staff, an approve_vault_document holder, or when the replacement is itself an APPROVED
--         document of the same folder and reference (the normal revision flow).
--  S6-11  Weekly / monthly org report packs were readable by project-scoped users (has_org_access
--         is true for any project grant in the org). Reads now need an org-wide / global grant, or
--         JAGS staff with org access.
--  S7-16  background_jobs: a subcontractor could queue handover-certificate renders (each files a
--         new approved vault revision and fills the org job cap). Data Book jobs now need staff, and
--         the certificate variant needs can_read_handover().
-- Requires can_read_handover() (20261101000100) and has_org_wide_access() (20261005090000).

-- ===== S6-02 =====
create or replace function public.vault_documents_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
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
  if old.status = 'superseded' and new.status is distinct from old.status then
    raise exception 'A superseded document cannot change status' using errcode = '42501';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'superseded') then
    raise exception 'An approved document can only be superseded by a newer approved revision' using errcode = '42501';
  end if;

  if old.status = 'approved' and new.status = 'superseded' then
    if public.is_jags_staff() then
      return new;
    end if;
    select f.project_id into v_project from public.vault_folders f where f.id = old.folder_id;
    if public.has_custom_permission(auth.uid(), 'approve_vault_document', v_project) then
      return new;
    end if;
    -- Normal revision flow: the replacement is an approved row of the same folder + reference.
    if new.superseded_by is not null and exists (
      select 1 from public.vault_documents r
      where r.id = new.superseded_by
        and r.folder_id = old.folder_id
        and r.status = 'approved'
        and r.document_reference is not distinct from old.document_reference
    ) then
      return new;
    end if;
    raise exception 'Only JAGS staff or an approver can supersede an approved document without an approved replacement'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.vault_documents_guard_immutable() from public, anon, authenticated;

drop trigger if exists vault_documents_guard_immutable on public.vault_documents;
create trigger vault_documents_guard_immutable
  before update on public.vault_documents
  for each row execute function public.vault_documents_guard_immutable();

-- ===== S6-11 =====
drop policy if exists generated_documents_monthly_reports_select on storage.objects;
create policy generated_documents_monthly_reports_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = 'monthly-reports'
    and (
      public.has_org_wide_access(((storage.foldername(name))[2])::uuid)
      or (public.is_jags_staff() and public.has_org_access(((storage.foldername(name))[2])::uuid))
    )
  );

drop policy if exists generated_documents_weekly_reports_select on storage.objects;
create policy generated_documents_weekly_reports_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = 'weekly-reports'
    and (
      public.has_org_wide_access(((storage.foldername(name))[2])::uuid)
      or (public.is_jags_staff() and public.has_org_access(((storage.foldername(name))[2])::uuid))
    )
  );

-- ===== S7-16 (additive restrictive policy; the permissive insert policy is untouched) =====
drop policy if exists background_jobs_insert_databook_roles on public.background_jobs;
create policy background_jobs_insert_databook_roles on public.background_jobs
  as restrictive for insert to authenticated
  with check (
    public.is_system_caller()
    or job_type <> 'render_data_book_pdf'
    or (
      (payload ->> 'variant') is null
      and public.is_jags_staff()
    )
    or (
      (payload ->> 'variant') = 'handover_certificate'
      and exists (
        select 1 from public.data_books d join public.projects p on p.id = d.project_id
        where d.id = ((payload ->> 'data_book_id'))::uuid and public.can_read_handover(p.id, p.organization_id)
      )
    )
  );
