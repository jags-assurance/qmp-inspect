-- Storage bucket limits (checklist T11). Buckets inspection-evidence, generated-documents and org-branding had
-- file_size_limit NULL and allowed_mime_types NULL. Values below are a SUPERSET of every upload path found in
-- apps/web and worker/, so no current path breaks. Where a type or size was uncertain the more permissive value
-- was chosen (marked UNCERTAIN). NOTE: a bucket limit is also capped by the project GLOBAL upload limit
-- (Dashboard > Storage > Settings), which must be >= 500 MB (docs/OPERATIONS_RUNBOOK.md, "Large vault uploads").
--
-- inspection-evidence: 524288000 bytes (500 MB)
--   Evidence: lib/vault/limits.ts VAULT_MAX_UPLOAD_MB = 500 (vault upload-form, TUS resumable, no accept= filter, so
--   ANY file type incl. DWG/DXF drawings is possible); migration 20261127000400 already raises existing limits to
--   500 MB. Other paths are smaller: checklist photos/NCR/punch/standalone/offline-sync 25 MB (MAX_PHOTO_BYTES,
--   PUNCH_PHOTO_MAX_BYTES), item documents 25 MB, register certificates 20 MB, email-inbound 25 MB, signatures small.
--   MIME: images (jpeg/png/webp/heic/heif/gif/bmp/tiff; photos use accept="image/*"), pdf, Word/Excel/PowerPoint
--   (+ OpenDocument), csv/txt/json (offline-sync marker is application/json), email (eml/msg), zip,
--   DWG/DXF variants, and application/octet-stream (browsers/providers label unknown types this way, e.g. .dwg,
--   .msg; also the TUS fallback in lib/storage/resumable-upload.ts). SVG and HTML are deliberately NOT allowed
--   (script risk; punch/email paths already reject them). UNCERTAIN: vault accepts any extension; anything with an
--   unusual MIME that is not octet-stream will now be refused by Storage.
--
-- generated-documents: 1073741824 bytes (1 GB)
--   Evidence: worker PDFs (Data Book capped by MAX_BOOK_BYTES = 150 MB and 2000 pages in
--   worker/src/jobs/dataBookHelpers.ts; reports, ITP, IRN, NCR, FAT, report packs are application/pdf via
--   vaultAutoFile.uploadGeneratedFile). The browser also uploads the handover package straight into this bucket
--   (issue-handover-form.tsx: any file, resumable, no size cap in UI; server hashes up to MAX_VERIFY_BYTES = 1 GB,
--   lib/handover/package-hash.ts) and acknowledgement evidence (<= 25 MB, lib/handover/helpers.ts: pdf, png, jpg,
--   webp, heic, doc(x), xls(x), txt, eml, msg). 1 GB matches the largest verifiable package and is far above the
--   150 MB Data Book PDF.
--   MIME: pdf, zip (+ x-zip-compressed), 7z/rar/gzip/tar (UNCERTAIN: package type is unrestricted in the UI),
--   images, Word/Excel, text, eml/msg, application/octet-stream.
--
-- org-branding: 2097152 bytes (2 MB)
--   Evidence: logo-upload-form.tsx MAX_FILE_SIZE_BYTES = 2 MB and lib/branding/actions.ts MAX_LOGO_SIZE_BYTES = 2 MB;
--   types image/png, image/jpeg, image/svg+xml, image/webp (ACCEPTED_TYPES). worker/src/jobs/orgBranding.ts only
--   reads from this bucket. SVG stays allowed because the logo form accepts it today.
--
-- ROLLBACK: update storage.buckets set file_size_limit = null, allowed_mime_types = null
--           where id in ('inspection-evidence','generated-documents','org-branding');
--   (inspection-evidence may instead be restored to its previous value; it was NULL before this migration.)
-- Idempotent: plain UPDATEs, safe to re-run; no-op where a bucket or column does not exist.

do $$
begin
  if to_regclass('storage.buckets') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then

    update storage.buckets
       set file_size_limit = 524288000,
           allowed_mime_types = array[
             'image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif','image/gif','image/bmp','image/tiff',
             'application/pdf',
             'application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-excel',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'application/vnd.ms-powerpoint',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation',
             'application/vnd.oasis.opendocument.text',
             'application/vnd.oasis.opendocument.spreadsheet',
             'text/plain','text/csv','application/json',
             'message/rfc822','application/vnd.ms-outlook',
             'application/zip','application/x-zip-compressed',
             'application/acad','application/x-acad','application/dwg','image/vnd.dwg','image/x-dwg',
             'application/dxf','image/vnd.dxf','image/x-dxf',
             'application/octet-stream'
           ]
     where id = 'inspection-evidence';

    update storage.buckets
       set file_size_limit = 1073741824,
           allowed_mime_types = array[
             'application/pdf',
             'application/zip','application/x-zip-compressed','application/x-7z-compressed',
             'application/vnd.rar','application/x-rar-compressed','application/gzip','application/x-tar',
             'image/jpeg','image/jpg','image/png','image/webp','image/heic',
             'application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-excel',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'text/plain','message/rfc822','application/vnd.ms-outlook',
             'application/octet-stream'
           ]
     where id = 'generated-documents';

    update storage.buckets
       set file_size_limit = 2097152,
           allowed_mime_types = array['image/png','image/jpeg','image/svg+xml','image/webp']
     where id = 'org-branding';
  end if;
end $$;
