-- Bell queries already use notifications_recipient_idx (recipient_user_id, is_read, created_at desc).
-- This adds an age index so the retention sweep (delete read rows > 90 days, any > 365 days) does not scan the table.
-- Idempotent. Rollback: drop index if exists public.notifications_created_at_idx;
create index if not exists notifications_created_at_idx on public.notifications (created_at);
