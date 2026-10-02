-- Fill in "who generated it" on generated vault documents filed BEFORE the worker started recording
-- the requesting user (worker/src/jobs/vaultAutoFile.ts now sets vault_documents.uploaded_by).
--
-- A generated document's storage_path is 'generated-documents:<path>', and the background job that
-- produced it stored the same <path> in background_jobs.result_storage_path with the requesting user
-- in payload->>'requested_by'. Only rows with no author yet are touched; nothing is overwritten, and
-- a requested_by that is not a real user id is ignored.
update public.vault_documents d
set uploaded_by = u.id
from public.background_jobs j
join public.users u on u.id::text = j.payload->>'requested_by'
where d.uploaded_by is null
  and d.storage_path like 'generated-documents:%'
  and j.result_storage_path = substring(d.storage_path from length('generated-documents:') + 1);
