-- O2: the worker only sweeps organisations that have an ENABLED automation_rules row (register_expiry
-- is the one exception), and nothing ever created those rows unless an admin saved each rule, so a
-- fresh organisation had no overdue / stuck-hold reminders at all. This seeds the four rules for every
-- existing organisation and, via a trigger, for every new one.
--
-- Defaults match the Automation rules page (threshold 24h, repeat 24h, enabled). `on conflict do
-- nothing` means a row an admin already saved (including one they switched off) is never touched,
-- and re-running the migration is a no-op.
-- Forward-only and idempotent.

create or replace function public.seed_default_automation_rules(p_organization_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.automation_rules (organization_id, rule_type, enabled, threshold_hours, repeat_hours)
  select p_organization_id, t.rule_type, true, 24, 24
  from (values ('hold_elapsed'), ('ncr_overdue'), ('punch_overdue'), ('register_expiry')) as t(rule_type)
  on conflict (organization_id, rule_type) do nothing;
$$;

revoke all on function public.seed_default_automation_rules(uuid) from public, anon, authenticated;

-- Existing organisations.
select public.seed_default_automation_rules(o.id) from public.organizations o;

-- New organisations.
create or replace function public.organizations_seed_automation_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_automation_rules(new.id);
  return new;
end;
$$;

revoke all on function public.organizations_seed_automation_rules() from public, anon, authenticated;

drop trigger if exists organizations_seed_automation_rules on public.organizations;
create trigger organizations_seed_automation_rules
  after insert on public.organizations
  for each row execute function public.organizations_seed_automation_rules();
