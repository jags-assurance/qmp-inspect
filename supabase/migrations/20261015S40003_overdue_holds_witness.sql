-- overdue_hold_points(): align with the app's notice rules (lib/signoff/actions.ts getNoticePeriodHours).
--   (a) non-blocking Witness ('W') levels are now flagged when the notice period has passed
--       (previously only is_blocking levels were ever listed);
--   (b) itp_items.notice_hours_override (R25) takes precedence, then the project's
--       notice_period_configs, then the org level's default_notice_hours;
--   (c) built-in fallback is H=48 / W=24 / anything else 24 (app: DEFAULT_NOTICE_PERIOD_HOURS[x] ?? 24;
--       the previous SQL fell back to 48);
--   (d) project_id is added as the LAST returned column (existing positional columns unchanged).
-- 'Planned date passed' rows keep their previous rule (blocking levels only).
-- The return type changes, so the function is dropped and recreated.
drop function if exists public.overdue_hold_points();

create function public.overdue_hold_points()
returns table (
  id uuid,
  itp_id uuid,
  activity text,
  itp_number text,
  project_label text,
  days_open integer,
  reason text,
  planned_date date,
  project_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with accessible as materialized (
    select p.id, p.organization_id, p.project_number, p.name
    from projects p
    where has_project_access(p.id, p.organization_id)
       or (is_jags_staff() and has_org_access(p.organization_id))
  ),
  progress as (
    select a.id, a.intervention, a.status, a.notified_at, i.activity, i.planned_date,
           i.notice_hours_override,
           t.id as itp_id, t.itp_number, t.project_id,
           ap.organization_id, ap.project_number, ap.name as project_name
    from activity_signoff_progress a
    join itp_items i on i.id = a.itp_item_id
    join itp_sections s on s.id = i.section_id
    join itps t on t.id = s.itp_id
    join accessible ap on ap.id = t.project_id
    where a.status in ('pending', 'notified')
  ),
  late_notice as (
    select n.id, n.itp_id, n.activity, n.itp_number,
           n.project_number || ' — ' || n.project_name as project_label,
           floor(extract(epoch from (now() - n.notified_at)) / 86400)::integer as days_open,
           'Notice period passed'::text as reason,
           n.planned_date,
           n.project_id
    from progress n
    join intervention_level_types lt
      on lt.organization_id = n.organization_id and lt.code = n.intervention
     and (lt.is_blocking or n.intervention = 'W')
    left join notice_period_configs npc
      on npc.project_id = n.project_id and npc.intervention = n.intervention
    where n.status = 'notified' and n.notified_at is not null
      and now() - n.notified_at >
          coalesce(
            n.notice_hours_override,
            npc.hours,
            lt.default_notice_hours,
            case n.intervention when 'H' then 48 when 'W' then 24 end,
            24
          )::numeric * interval '1 hour'
  ),
  late_planned as (
    select n.id, n.itp_id, n.activity, n.itp_number,
           n.project_number || ' — ' || n.project_name as project_label,
           (current_date - n.planned_date)::integer as days_open,
           'Planned date passed'::text as reason,
           n.planned_date,
           n.project_id
    from progress n
    join intervention_level_types lt
      on lt.organization_id = n.organization_id and lt.code = n.intervention and lt.is_blocking
    where n.planned_date is not null and n.planned_date < current_date
      and n.id not in (select l.id from late_notice l)
  )
  select * from late_notice
  union all
  select * from late_planned
  order by 6 desc;
$$;

revoke all on function public.overdue_hold_points() from public, anon;
grant execute on function public.overdue_hold_points() to authenticated, service_role;
