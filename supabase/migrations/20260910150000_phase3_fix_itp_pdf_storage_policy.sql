-- Fixes a real, pre-existing bug found while diagnosing the monthly-report-pack download link:
-- generated_documents_select's EXISTS subquery called storage.foldername(p.name) — p.name is the
-- PROJECT's name column (a free-text project title, e.g. "Substation Bldg 2 Electrical Upgrade"),
-- not the storage object's own path. It should never have referenced p.name at all; the object's
-- path is the outer query's own `name` column. Since this bug meant the policy could never actually
-- match any real object, ITP PDF downloads have likely never worked (consistent with this being the
-- first time the render_itp_pdf pipeline's download step was ever live-verified — no PDF had been
-- generated to test against before now). The real path shape, from renderItpPdf.ts, is
-- itps/{itp_id}/{itp_number}-rev{revision}.pdf.
drop policy generated_documents_select on storage.objects;

create policy generated_documents_itp_pdf_select on storage.objects
  for select using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = 'itps'
    and exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id::text = (storage.foldername(name))[2]
        and public.has_org_access(p.organization_id)
    )
  );
