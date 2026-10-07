-- S4-18: sign-off comment and reject outcome. Idempotent, additive.
-- A party can sign off with an optional comment, or reject (return) the release with a mandatory
-- reason. A rejection leaves the row in 'pending' (it still blocks completion exactly like an
-- unsigned point), and records who rejected it, when, and why, so the inspector sees the reason and
-- the party can sign once the issue is dealt with. A later sign-off clears the rejection fields.

alter table public.activity_signoff_progress
  add column if not exists signoff_comment text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.users (id) on delete set null,
  add column if not exists rejection_reason text,
  add column if not exists reject_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activity_signoff_progress_comment_len') then
    alter table public.activity_signoff_progress
      add constraint activity_signoff_progress_comment_len
      check (char_length(coalesce(signoff_comment, '')) <= 1000 and char_length(coalesce(rejection_reason, '')) <= 1000) not valid;
  end if;
end $$;
