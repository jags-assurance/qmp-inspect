-- E-05: de-duplicate inbound email webhook retries.
--
-- Postmark (and similar providers) retry a delivery when the first response was slow or failed, and
-- the route used a Date.now() storage path, so every retry created another copy of every attachment.
-- The route now records each provider MessageID here before ingesting and ignores a repeat.
-- Service role only (RLS on, no policies). Idempotent.

create table if not exists public.inbound_email_messages (
  message_id text primary key,
  project_id uuid references public.projects (id) on delete cascade,
  sender text,
  received_at timestamptz not null default now()
);

alter table public.inbound_email_messages enable row level security;
revoke all on public.inbound_email_messages from anon, authenticated;
