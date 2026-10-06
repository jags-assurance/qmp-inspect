-- Stage 4 hardening: signature metadata on completed inspections + IRN void (revoke) with reason.
alter table public.inspection_records
  add column if not exists signed_by_name text,
  add column if not exists signed_at timestamptz,
  add column if not exists witness_name text,
  add column if not exists witness_signature text;

alter table public.irns
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.users (id),
  add column if not exists void_reason text;
