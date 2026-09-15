-- Phase 3 follow-up: Power BI reporting view for punch-list items and standalone FAT assignments
-- (R110). See 20260910120000_phase3_powerbi_reporting_views.sql's header comment for the full
-- rationale on why these views carry no has_org_access()-style row filtering and are instead
-- isolated purely by who can log in as powerbi_reader — the same applies here.
--
-- Punch-list items (punch_list_items) and standalone FAT assignments (standalone_assignments) are
-- newer additions that post-date the five views in that file and aren't covered by
-- computeProjectKpis() in apps/web/lib/kpis/compute.ts (that file is scoped to the client-facing
-- dashboard's existing KPI set) — this view is new cross-client analytics for R110's "JAGS-internal
-- reporting" spirit, not a mirror of app-side logic like the other five views are.
--
-- --------------------------------------------------------------------------------------------
-- 6. Punch-list and standalone-FAT summary (R110) — open/closed punch-list items and standalone
--    FAT conclusion counts (pass / conditional_pass / fail, from completed assignments only), per
--    project.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_punch_list_and_fat as
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  count(distinct pli.id) filter (where pli.status != 'closed') as open_punch_items,
  count(distinct pli.id) filter (where pli.status = 'closed') as closed_punch_items,
  count(distinct sa.id) filter (where sa.status = 'completed' and sa.conclusion = 'pass') as fat_pass_count,
  count(distinct sa.id) filter (where sa.status = 'completed' and sa.conclusion = 'conditional_pass') as fat_conditional_pass_count,
  count(distinct sa.id) filter (where sa.status = 'completed' and sa.conclusion = 'fail') as fat_fail_count
from public.projects p
left join public.punch_list_items pli on pli.project_id = p.id
left join public.standalone_assignments sa on sa.project_id = p.id
group by p.organization_id, p.id, p.project_number, p.name;

comment on view public.vw_powerbi_punch_list_and_fat is
  'Power BI (R110): open/closed punch-list item counts and standalone FAT conclusion counts (pass/conditional_pass/fail) per project. New cross-client analytics, not a mirror of compute.ts.';

grant select on public.vw_powerbi_punch_list_and_fat to powerbi_reader;
