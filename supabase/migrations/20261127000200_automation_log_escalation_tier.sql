-- O1: overdue reminders must go out once per escalation step (due-soon, tier 1, 2, 3), not once per
-- repeat window. The worker's dedupe ledger therefore records which step each nudge was for; only the
-- final step (3) is re-sent after repeat_hours. Rows written before this migration have tier null and
-- are simply ignored by the per-step lookup (the item gets one fresh nudge at its current step).
-- The worker falls back to the old time-window check until this column exists.
-- Forward-only and idempotent.

alter table public.automation_notification_log add column if not exists tier smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'automation_notification_log_tier_valid') then
    alter table public.automation_notification_log
      add constraint automation_notification_log_tier_valid check (tier is null or tier between 0 and 3);
  end if;
end $$;

create index if not exists automation_notification_log_step_idx
  on public.automation_notification_log (rule_id, entity_id, tier, sent_at desc);

comment on column public.automation_notification_log.tier is 'Escalation step the nudge was for: 0 due soon, 1-3 overdue tier (3 = final, repeats). Null for rows from before per-tier dedupe.';
