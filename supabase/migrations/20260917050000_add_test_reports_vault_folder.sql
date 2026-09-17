-- Adds a 12th fixed vault folder, "Test Reports", for contractor/lab test reports (e.g. NDT
-- reports, material test certificates, hydrotest records) — distinct from "Certificates", which
-- the client asked to keep as-is (calibration/qualification-style certificates) rather than
-- reusing for this. Deliberately does NOT touch the per-item evidence photo pipeline
-- (lib/checklists/photo-upload-helpers.ts, the offline queue, compression) — this folder is for
-- documents someone deliberately uploads through the vault, same as every other vault folder,
-- not an auto-mirror of every inspection photo.
--
-- create_default_vault_folders() only fires on new project inserts (see
-- 20260910010000_phase2_document_vault.sql's own header comment on this same gap for the
-- original 11) — the backfill below is required for this new folder to exist on any project
-- created before this migration runs.

alter table public.vault_folders drop constraint vault_folders_folder_key_check;
alter table public.vault_folders add constraint vault_folders_folder_key_check check (folder_key in (
  'drawings',
  'specifications',
  'standards_codes',
  'material_submittals',
  'rfis',
  'method_statements',
  'itps_approved',
  'checklists_forms',
  'approvals_correspondence',
  'certificates',
  'general_reference',
  'test_reports'
));

create or replace function public.create_default_vault_folders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vault_folders (project_id, folder_key, name) values
    (new.id, 'drawings', 'Drawings'),
    (new.id, 'specifications', 'Specifications'),
    (new.id, 'standards_codes', 'Standards & Codes'),
    (new.id, 'material_submittals', 'Material Submittals'),
    (new.id, 'rfis', 'RFIs'),
    (new.id, 'method_statements', 'Method Statements'),
    (new.id, 'itps_approved', 'ITPs (Approved)'),
    (new.id, 'checklists_forms', 'Checklists & Forms'),
    (new.id, 'approvals_correspondence', 'Approvals & Correspondence'),
    (new.id, 'certificates', 'Certificates'),
    (new.id, 'general_reference', 'General Reference'),
    (new.id, 'test_reports', 'Test Reports');
  return new;
end;
$$;

insert into public.vault_folders (project_id, folder_key, name)
select p.id, 'test_reports', 'Test Reports'
from public.projects p
where not exists (
  select 1 from public.vault_folders f where f.project_id = p.id and f.folder_key = 'test_reports'
);
