-- Closes two gaps found while cross-checking a client-facing sample dossier against the real app
-- (Reqs adjacent to R92-R100, register-fed verification):
--
-- 1. Material traceability (spec clause pattern: "material shall be traceable to PO/batch/heat
--    number and accompanied by a CoC/MTC; damaged or unidentified material shall be segregated
--    pending disposition"). material_register (20260910050000_phase3_registers.sql) only tracked
--    submittal APPROVAL status (A/B/C/D) — a design-review concept — with no field for the
--    physical-delivery traceability identifiers or for a receiving-inspection hold/segregation
--    state, which is a materially different thing (an approved material can still arrive damaged
--    or without its certificate). Adding both to the same register rather than a new table: it's
--    still "is this material fit to use," just checked at a different point in its lifecycle, and
--    every existing consumer of material_register (checkMaterial in lib/registers/verify.ts) only
--    needs to also look at receipt_status.
--
-- 2. Field-to-instrument linkage (the "which calibrated tool did this measurement/termination use"
--    traceability question raised by the dossier's calibration register — you can't answer "which
--    records are affected if instrument X drifted out of calibration" if no record ever says which
--    instrument was used). checkCalibration in lib/registers/verify.ts already picks the project's
--    single most-relevant calibration row (soonest due date) as an ASSIST/warning — this migration
--    lets the inspector actually record which specific instrument they used, as a real link rather
--    than an inferred one.

alter table public.material_register
  add column heat_number text,
  add column batch_number text,
  add column po_reference text,
  add column certificate_reference text,
  add column receipt_status text not null default 'released'
    check (receipt_status in ('released', 'quarantined_pending_disposition', 'on_hold')),
  add column disposition_notes text;

alter table public.checklist_responses
  add column calibration_asset_id uuid references public.calibration_register (id) on delete set null;
