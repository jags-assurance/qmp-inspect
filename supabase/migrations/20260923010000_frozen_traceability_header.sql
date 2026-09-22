-- R64/R103/R125: the traceability header frozen onto inspection_records at creation
-- (20260909240000_phase1_checklists_inspections.sql) already covers project_name/itp_number/
-- activity/location/inspection_date/inspector_id, but not client name, applicable spec/standard, or
-- the governing drawing revision -- those stayed live-joined to itps/projects (or, for a governing
-- drawing, weren't captured at all), so a record wouldn't reflect what was actually in force at
-- inspection time if the source row was later edited.
--
-- All four new columns are nullable: this is best-effort freezing, same posture as
-- inspection_records.location. A record from before this migration, or one whose activity has no
-- drawing linked, simply has nulls here -- never a reason to block inspection start/completion.
--
-- governing_drawing_document_id on itp_items is the missing "which drawing governs this activity"
-- link R103 flagged (drawing_markups only has a polymorphic pin-drop reference, no such concept).
-- It points at a vault_documents row (expected, not enforced, to live in the 'drawings' folder --
-- see the picker in add-item-form.tsx) and is optional: plenty of activities have no single
-- governing drawing.

alter table public.inspection_records
  add column client_name text,
  add column applicable_standard text,
  add column governing_drawing_reference text,
  add column governing_drawing_revision text;

alter table public.itp_items
  add column governing_drawing_document_id uuid references public.vault_documents (id) on delete set null;
