-- Inbound email-to-vault: quarantine messages from senders that are not recognised for the project
-- (audit M10). The route stores them here, never files their attachments, and a JAGS Admin can review.
-- Idempotent. ROLLBACK:
--   alter table public.inbound_email_messages drop column if exists status, drop column if exists subject,
--     drop column if exists quarantine_reason, drop column if exists attachment_count;
alter table public.inbound_email_messages add column if not exists status text not null default 'accepted';
alter table public.inbound_email_messages add column if not exists subject text;
alter table public.inbound_email_messages add column if not exists quarantine_reason text;
alter table public.inbound_email_messages add column if not exists attachment_count integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inbound_email_messages_status_check') then
    alter table public.inbound_email_messages
      add constraint inbound_email_messages_status_check check (status in ('accepted', 'quarantined'));
  end if;
end $$;

create index if not exists inbound_email_messages_quarantine_idx
  on public.inbound_email_messages (project_id, received_at desc) where status = 'quarantined';
