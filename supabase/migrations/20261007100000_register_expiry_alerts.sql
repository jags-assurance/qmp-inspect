-- Register expiry alerts: new automation rule type + per-item/per-threshold dedupe ledger.
alter table public.automation_rules drop constraint if exists automation_rules_rule_type_check;
alter table public.automation_rules
  add constraint automation_rules_rule_type_check
  check (rule_type in ('hold_elapsed', 'ncr_overdue', 'punch_overdue', 'register_expiry'));

-- One row per (register item, its expiry date, threshold) alert sent. Keyed on expiry_date so a
-- renewed certificate (new expiry date) starts a fresh alert cycle. Worker (service role) writes only.
create table if not exists public.register_expiry_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('calibration', 'welder', 'personnel')),
  entity_id uuid not null,
  expiry_date date not null,
  threshold_days int not null,
  sent_at timestamptz not null default now(),
  unique (entity_type, entity_id, expiry_date, threshold_days)
);

create index if not exists register_expiry_notifications_org_idx
  on public.register_expiry_notifications (organization_id);

alter table public.register_expiry_notifications enable row level security;

create policy register_expiry_notifications_select on public.register_expiry_notifications
  for select using (public.is_jags_staff() and public.has_org_access(organization_id));
