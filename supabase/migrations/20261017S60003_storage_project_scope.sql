-- Storage SELECT policies for generated-documents ncrs/, irns/, databooks/, ncr-closeouts/ used
-- has_org_access(), so a project-scoped party could read other projects' PDFs in the same org.
-- Path layout is '<prefix>/<record id>/...'; project is resolved through the record. Same pattern as
-- 20260916110000 (itps/inspections/fat-reports). weekly/monthly-reports stay org-level (untouched).
-- Idempotent.
drop policy if exists generated_documents_ncr_pdf_select on storage.objects;
create policy generated_documents_ncr_pdf_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'ncrs'
  and (storage.foldername(name))[2] in (
    select n.id::text from public.ncrs n join public.projects p on p.id = n.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_irn_pdf_select on storage.objects;
create policy generated_documents_irn_pdf_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'irns'
  and (storage.foldername(name))[2] in (
    select irn.id::text
    from public.irns irn
    join public.inspection_records r on r.id = irn.inspection_record_id
    join public.projects p on p.id = r.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_data_book_pdf_select on storage.objects;
create policy generated_documents_data_book_pdf_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'databooks'
  and (storage.foldername(name))[2] in (
    select d.id::text from public.data_books d join public.projects p on p.id = d.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_ncr_closeout_certificate_select on storage.objects;
create policy generated_documents_ncr_closeout_certificate_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'ncr-closeouts'
  and (storage.foldername(name))[2] in (
    select n.id::text from public.ncrs n join public.projects p on p.id = n.project_id
    where has_project_access(p.id, p.organization_id)
  )
);
