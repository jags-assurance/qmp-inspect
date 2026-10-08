-- U7: record when a user accepted the terms of use, and which version. Idempotent, additive, nullable.
-- Null means "has not accepted yet" and never blocks sign-in: the app only shows a one-time, dismissible
-- banner. A user can already update their own users row (users_update policy); the privileged-column
-- guard trigger only protects role/activation columns, so no policy change is needed for these two.
-- Acceptance is a plain record (who, when, which version); nothing here deletes or rewrites history.

alter table public.users
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.users.terms_accepted_at is 'When this user accepted the terms of use (U7). Null = not yet accepted.';
comment on column public.users.terms_version is 'The TERMS_VERSION constant (apps/web/lib/terms/constants.ts) the user accepted.';
