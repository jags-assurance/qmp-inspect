-- Adds itp_id to overdue_hold_points() so the dashboard's "Overdue hold points" window can open the
-- exact ITP ("Review →") instead of the ITP register. Same access check and notice-hours logic as
-- 20261002140000_overdue_hold_points_function.sql; only the returned columns change (so the
-- function is dropped and recreated).
drop function if exists public.overdue_hold_points();

create function public.overdue_hold_points()
returns table (
  id uuid,
  itp_id uuid,
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
    select a.id, a.intervention, a.notified_at, i.activity, t.id as itp_id, t.itp_number, t.project_id,
           ap.organization_id, ap.project_number, ap.name as project_name
    from activity_signoff_progress a
    join itp_items i on i.id = a.itp_item_id
    join itp_sections s on s.id = i.section_id
    join itps t on t.id = s.itp_id
    join accessible ap on ap.id = t.project_id
    where a.status = 'notified' and a.notified_at is not null
  )
  select n.id,
         n.itp_id,
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
  order by 6 desc;
$$;

revoke all on function public.overdue_hold_points() from public, anon;
grant execute on function public.overdue_hold_points() to authenticated;
