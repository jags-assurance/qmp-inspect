-- Handover certificates are only ever written by two SECURITY DEFINER functions:
--   issue_data_book_handover()  (creates the certificate when a Data Book is issued)
--   acknowledge_handover()      (records the client's formal acceptance)
-- Nothing in the app writes the table directly, but the old staff write policies still let any
-- JAGS staff member edit or delete a certificate (certificate number, acknowledgement, package
-- hash) straight through the API. Remove them: with RLS on and no write policy, direct writes are
-- refused, while the definer functions (owned by a role that bypasses RLS) keep working.
-- Idempotent.
drop policy if exists handover_certificates_write_i on public.handover_certificates;
drop policy if exists handover_certificates_write_u on public.handover_certificates;
drop policy if exists handover_certificates_write_d on public.handover_certificates;
drop policy if exists handover_certificates_write on public.handover_certificates;
drop policy if exists handover_certificates_staff_write on public.handover_certificates;

alter table public.handover_certificates enable row level security;
