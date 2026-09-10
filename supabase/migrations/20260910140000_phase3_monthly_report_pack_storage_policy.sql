-- Fixes a real bug found live-testing the monthly report pack feature: the existing
-- generated_documents_select policy only matches paths shaped "itps/{itp_id}/...", so a completed
-- pack correctly uploaded to "monthly-reports/{organization_id}/{year-month}/report-pack.pdf" had no
-- matching SELECT policy at all. createSignedUrl() failed silently (its error was destructured away
-- and never checked in listMonthlyReportPacks), so the UI showed "Rendering…" forever even though
-- the file existed and the background_jobs row was genuinely "completed".
create policy generated_documents_monthly_reports_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = 'monthly-reports'
    and public.has_org_access(((storage.foldername(name))[2])::uuid)
  );
