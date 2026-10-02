-- Overdue hold points, computed in one database round trip.
--
-- The dashboard used to fetch notified sign-off rows through a 4-level nested PostgREST embed
-- (activity_signoff_progress -> itp_items -> itp_sections -> itps -> projects), then two dependent
-- lookups (level types, notice-period configs), and filter in JavaScript. Under row-level security
-- that embed took ~1.2s: the plan carried 53 subplans and called has_project_access once per
-- nested row (81 times for 110 rows).
--
-- This function does the same thing in one statement. Access is checked ONCE PER PROJECT — the same
-- predicate the sibling RLS policies use (project access, or JAGS staff with org access) — and the
-- joins below it then run without per-row policy evaluation. SECURITY DEFINER is what allows that;
-- the explicit `accessible` CTE is the access control, so a caller can never see a project they
-- could not already see through RLS.
--
-- Notice-hours precedence is unchanged: per-project notice_period_configs override, then the
-- organisation's configured default for that level, then the original H=48h / W=24h fallback, then 48h.
create or replace function public.overdue_hold_points()
returns table (
  id uuid,
  activity text,
  itp_number text,
  project_label text,
  days_open integer
)
language sql
stable
security definer
set search_path = public
as $$
  with accessible as materialized (
    select p.id, p.organization_id, p.project_number, p.name
    from projects p
    where has_project_access(p.id, p.organization_id)
       or (is_jags_staff() and has_org_access(p.organization_id))
  ),
  notified as (
    select a.id, a.intervention, a.notified_at, i.activity, t.itp_number, t.project_id,
           ap.organization_id, ap.project_number, ap.name as project_name
    from activity_signoff_progress a
    join itp_items i on i.id = a.itp_item_id
    join itp_sections s on s.id = i.section_id
    join itps t on t.id = s.itp_id
    join accessible ap on ap.id = t.project_id
    where a.status = 'notified' and a.notified_at is not null
  )
  select n.id,
         n.activity,
         n.itp_number,
         n.project_number || ' — ' || n.project_name,
         floor(extract(epoch from (now() - n.notified_at)) / 86400)::integer
  from notified n
  join intervention_level_types lt
    on lt.organization_id = n.organization_id and lt.code = n.intervention and lt.is_blocking
  left join notice_period_configs npc
    on npc.project_id = n.project_id and npc.intervention = n.intervention
  where now() - n.notified_at >
        coalesce(
          npc.hours,
          lt.default_notice_hours,
          case n.intervention when 'H' then 48 when 'W' then 24 end,
          48
        )::numeric * interval '1 hour'
  order by 5 desc;
$$;

revoke all on function public.overdue_hold_points() from public, anon;
grant execute on function public.overdue_hold_points() to authenticated;
