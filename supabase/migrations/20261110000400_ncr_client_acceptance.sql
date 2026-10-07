-- S5-22 (remainder): client acceptance step on an NCR disposition. Idempotent, additive.
-- When a client party must accept the disposition (e.g. use-as-is / repair), their decision is stored
-- on the NCR. The columns are only written by the server action, which checks that the caller is a
-- client user of the project or JAGS staff.

alter table public.ncrs
  add column if not exists client_acceptance_required boolean not null default false,
  add column if not exists client_accepted_at timestamptz,
  add column if not exists client_accepted_by uuid references public.users (id) on delete set null,
  add column if not exists client_acceptance_decision text,
  add column if not exists client_acceptance_comment text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ncrs_client_acceptance_decision_check') then
    alter table public.ncrs
      add constraint ncrs_client_acceptance_decision_check
      check (client_acceptance_decision is null or client_acceptance_decision in ('accepted', 'rejected')) not valid;
  end if;
end $$;
