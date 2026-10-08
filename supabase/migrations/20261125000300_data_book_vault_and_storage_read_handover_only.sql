-- L16: the issued Data Book PDF (and the handover certificate PDF) is filed into the vault 'certificates'
-- folder and stored under generated-documents/databooks/<data_book_id>/..., both readable by anyone with
-- project access (vault_documents_select = has_project_access; databooks/ storage = has_project_access).
-- A contractor / TPI / subcontractor party could therefore open it although the book rows themselves
-- are restricted with can_read_handover() (20261101000100).
--
-- Narrow decision: only vault rows whose storage_path is a generated databooks/ object (the Data Book
-- and the handover certificate the worker files there) and the matching databooks/ storage objects now
-- require can_read_handover() (project staff + clients). Every other document in 'certificates' (and
-- every other folder) keeps today's has_project_access read rule. Staff are unaffected; the worker uses
-- the service role. Idempotent; no data changes.

-- vault_documents SELECT: latest prior definition is 20260914000000 (project-scoped has_project_access).
drop policy if exists vault_documents_select on public.vault_documents;
create policy vault_documents_select on public.vault_documents for select using (
  exists (
    select 1 from public.vault_folders f join public.projects p on p.id = f.project_id
    where f.id = vault_documents.folder_id
      and public.has_project_access(p.id, p.organization_id)
      and (
        vault_documents.storage_path is null
        or vault_documents.storage_path not like 'generated-documents:databooks/%'
        or public.can_read_handover(p.id, p.organization_id)
      )
  )
);

-- databooks/ storage objects: latest prior definition is 20261017S60003 (has_project_access).
drop policy if exists generated_documents_data_book_pdf_select on storage.objects;
create policy generated_documents_data_book_pdf_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'databooks'
  and (storage.foldername(name))[2] in (
    select d.id::text from public.data_books d join public.projects p on p.id = d.project_id
    where public.can_read_handover(p.id, p.organization_id)
  )
);
