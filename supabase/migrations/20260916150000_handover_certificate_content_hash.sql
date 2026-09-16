-- Immutable Handover Snapshot (scoped increment): a SHA-256 fingerprint of the exact package file
-- bytes, computed client-side at issue time (see issue-handover-form.tsx's sha256Hex) and stored
-- alongside package_storage_path. This is what makes the handover package actually verifiable rather
-- than just "present" (the previous fix, 20260916130000, only guaranteed a file exists) — anyone who
-- receives the file through a separate channel later (forwarded by email, copied off a USB stick) can
-- recompute its hash and compare it to this certified value to prove it's the exact same bytes that
-- were issued, not a since-modified or substituted copy. A full "immutable bundle" covering every
-- underlying record (ITPs/inspections/NCRs/punch list as of the issue moment, individually hashed)
-- is future scope — this covers the actual handover artifact itself, which is what a client is
-- formally accepting receipt of.
alter table public.handover_certificates
  add column package_sha256 text;

comment on column public.handover_certificates.package_sha256 is
  'SHA-256 hex digest of the exact package_storage_path file bytes, computed client-side at issue '
  'time. Lets a later holder of the file verify it is unmodified from what was certified.';
