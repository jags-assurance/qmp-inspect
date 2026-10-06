-- Standalone assignments: record the clearance note and a clearance number alongside cleared_by /
-- cleared_at, so the FAT report can show a proper close-out record.
alter table public.standalone_assignments
  add column if not exists clearance_notes text,
  add column if not exists clearance_number text;
