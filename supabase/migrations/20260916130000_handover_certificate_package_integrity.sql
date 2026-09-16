-- Round-table finding: a Handover Certificate could be issued (and then acknowledged by the client)
-- with no actual package file behind it at all — handover_certificates never had a package column,
-- and the Handover Portal's download slot has always hardcoded "Package: Not yet available" (see
-- apps/web/app/inspect/handover/page.tsx's own prior comment). The document a client is being asked
-- to formally accept receipt of should never be able to not exist. This adds the column and a
-- matching storage.objects policy; issueHandoverAction (app code, separate change) now requires it
-- to be set before a certificate can be inserted at all, so every NEW certificate is guaranteed to
-- have one. Existing rows (there are none in this fresh project, but any future restore/import could
-- carry pre-migration rows) are left null on purpose — the UI's job to flag those, not this migration's
-- job to fabricate a package that was never actually issued.

alter table public.handover_certificates
  add column package_storage_path text;

comment on column public.handover_certificates.package_storage_path is
  'Path within the generated-documents bucket (handover/{data_book_id}/...) to the actual handover '
  'package file. Required by issueHandoverAction for every new certificate; null only on legacy rows '
  'issued before this column existed, which the Handover Portal flags with a warning banner.';

drop policy if exists generated_documents_handover_select on storage.objects;
create policy generated_documents_handover_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover'
  and (storage.foldername(name))[2] in (
    select db.id::text from public.data_books db join public.projects p on p.id = db.project_id
    where has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_handover_insert on storage.objects;
create policy generated_documents_handover_insert on storage.objects for insert with check (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover'
  and is_jags_staff()
  and (storage.foldername(name))[2] in (
    select db.id::text from public.data_books db join public.projects p on p.id = db.project_id
    where has_project_access(p.id, p.organization_id)
  )
);
