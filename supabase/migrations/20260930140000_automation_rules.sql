-- Real gap confirmed by an infra audit: every notification in this app fires synchronously inside a
-- Server Action, triggered by someone clicking something — there is zero time/schedule-driven
-- automation anywhere (no cron, no "check for overdue X" sweep). In a multi-party project (client,
-- subcontractor, TPI, JAGS staff all depending on each other to notice things), that means a stuck
-- Hold or an overdue NCR only gets chased up if a human happens to look. This adds a real, admin-
-- configurable automation layer: per-organisation rules the worker's own periodic sweep (see
-- worker/src/automation.ts) evaluates and turns into real notifications, with no code change needed
-- to add another organisation — just configure the rule.
--
-- Deliberately per-organisation only (not per-project) to keep the first version simple — an org
-- with different needs per project can be a follow-up, not required for this to be useful today.
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- hold_elapsed: a Hold (blocking intervention level) has sat 'notified' with no response past
  --   threshold_hours — nudges JAGS admins with access to that org.
  -- ncr_overdue: an open NCR's due_date has passed — nudges its assignee (if set) + JAGS admins.
  -- punch_overdue: an open/resolved punch-list item's due_date has passed — nudges the responsible
  --   party's linked login (if any) + JAGS admins.
  rule_type text not null check (rule_type in ('hold_elapsed', 'ncr_overdue', 'punch_overdue')),
  enabled boolean not null default true,
  -- How long past the trigger condition before the FIRST nudge fires.
  threshold_hours int not null default 24 check (threshold_hours > 0),
  -- Minimum gap before the SAME entity can trigger this rule again — stops a still-overdue item
  -- from re-notifying every single sweep cycle.
  repeat_hours int not null default 24 check (repeat_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, rule_type)
);

create trigger automation_rules_set_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

-- One row per (rule, entity) notification actually sent — purely a dedup ledger for the worker sweep
-- (see repeat_hours above), not a user-facing audit trail (that's audit_log's job).
create table public.automation_notification_log (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules (id) on delete cascade,
  entity_id uuid not null,
  sent_at timestamptz not null default now()
);

create index automation_notification_log_lookup_idx
  on public.automation_notification_log (rule_id, entity_id, sent_at desc);

alter table public.automation_rules enable row level security;
alter table public.automation_notification_log enable row level security;

create policy automation_rules_select on public.automation_rules
  for select using (public.has_org_access(organization_id));

-- Staff-only write, same boundary as Numbering/Module Licensing/Staff Access — configuring what
-- triggers an automated nudge to your own team is an account-administration concern, not a
-- self-managed-client-editable setting (unlike e.g. brand colors).
create policy automation_rules_write on public.automation_rules
  for all using (
    public.is_jags_staff() and public.has_org_access(organization_id)
  ) with check (
    public.is_jags_staff() and public.has_org_access(organization_id)
  );

-- Read-only for staff (debugging "why didn't this fire" / "why did this fire twice") — written only
-- by the worker's service-role connection, which bypasses RLS entirely, so no write policy is needed.
create policy automation_notification_log_select on public.automation_notification_log
  for select using (
    exists (
      select 1 from public.automation_rules r
      where r.id = automation_notification_log.rule_id and public.has_org_access(r.organization_id)
    )
  );
