-- Phase 3: secure read-only reporting views for the JAGS-internal Power BI (R110).
-- These are NOT a UI screen — Power BI Desktop connects directly to Postgres (a "live"/DirectQuery
-- or Import connection, the user's choice in Power BI) using a dedicated login role that has no
-- access to anything except these views. Clients never get this; they get the monthly report pack
-- instead (see the generate_monthly_report_pack background job and R109).
--
-- Deliberately NO RLS-equivalent filtering is baked into these views: has_org_access() depends on
-- auth.uid() (the calling Postgres role's JWT claims), which a plain login role like powerbi_reader
-- never has, so a per-row filter here would just make every view return nothing. Isolation instead
-- comes from who is allowed to connect as powerbi_reader at all (JAGS-internal staff only) — the
-- same "all clients, all projects" scope R110 explicitly asks for, mirrored by organization_id and
-- project_id being included as plain columns on every view so Power BI can slice/filter by tenant
-- itself once connected.
--
-- Each view translates the equivalent logic already implemented in apps/web/lib/kpis/compute.ts
-- (see that file's header comment for why compute.ts's own double-scoping doesn't apply here) into
-- SQL, rather than inventing new metrics. Where compute.ts has a fallback (e.g. hold-point
-- turnaround falls back to an approval-proxy calculation when no signoff-chain data exists yet),
-- these views only implement the precise, signoff-chain-backed calculation — simplifying rather
-- than reproducing app-side fallback branching in SQL. That's called out per view below.

-- --------------------------------------------------------------------------------------------
-- 1. Inspections completed vs planned (R110) — mirrors compute.ts's "inspectionsCompleted" /
--    "inspectionsPlanned" (completed = inspection_records with a non-null overall_result; planned =
--    evidence_type = 1 itp_items on approved-or-client-accepted ITPs), rolled up per project.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_inspections_completed_vs_planned as
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  count(distinct ir.id) filter (where ir.overall_result is not null) as inspections_completed,
  count(distinct ii.id) filter (
    where ii.evidence_type = 1 and i.status in ('approved', 'client_accepted')
  ) as inspections_planned
from public.projects p
left join public.itps i on i.project_id = p.id
left join public.itp_sections s on s.itp_id = i.id
left join public.itp_items ii on ii.section_id = s.id
left join public.inspection_records ir on ir.project_id = p.id
group by p.organization_id, p.id, p.project_number, p.name;

comment on view public.vw_powerbi_inspections_completed_vs_planned is
  'Power BI (R110): inspections completed vs planned per project. Mirrors computeProjectKpis() in apps/web/lib/kpis/compute.ts.';

-- --------------------------------------------------------------------------------------------
-- 2. ITP completion % (R110) — mirrors compute.ts's "itpCompletionRate": % of a project's ITPs
--    with status = 'client_accepted'.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_itp_completion as
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  count(i.id) as total_itps,
  count(i.id) filter (where i.status = 'client_accepted') as client_accepted_itps,
  round(100.0 * count(i.id) filter (where i.status = 'client_accepted') / nullif(count(i.id), 0), 1)
    as itp_completion_pct
from public.projects p
left join public.itps i on i.project_id = p.id
group by p.organization_id, p.id, p.project_number, p.name;

comment on view public.vw_powerbi_itp_completion is
  'Power BI (R110): ITP completion % per project (client_accepted / total). Mirrors computeProjectKpis() in apps/web/lib/kpis/compute.ts.';

-- --------------------------------------------------------------------------------------------
-- 3. Hold-point turnaround (R110) — mirrors the "signoff_chain" branch of compute.ts's
--    "holdPointTurnaroundHours" only (average hours between notified_at and signed_off_at on Hold
--    rows in activity_signoff_progress). compute.ts's approval-proxy fallback (used only when no
--    signoff-chain data exists yet for a project) is deliberately NOT reproduced here — Power BI is
--    an aggregate, cross-client analytics tool, and mixing a precise measurement with a proxy
--    estimate in the same column would misrepresent the metric. Projects with no completed
--    signoff-chain hold points simply have zero rows in this view for that project.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_hold_point_turnaround as
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  count(*) as hold_points_measured,
  round(avg(extract(epoch from (asp.signed_off_at - asp.notified_at)) / 3600.0), 2)
    as avg_hold_point_turnaround_hours
from public.activity_signoff_progress asp
join public.itp_items ii on ii.id = asp.itp_item_id
join public.itp_sections s on s.id = ii.section_id
join public.itps i on i.id = s.itp_id
join public.projects p on p.id = i.project_id
where asp.intervention = 'H'
  and asp.notified_at is not null
  and asp.signed_off_at is not null
group by p.organization_id, p.id, p.project_number, p.name;

comment on view public.vw_powerbi_hold_point_turnaround is
  'Power BI (R110): average Hold-point turnaround hours (notified_at -> signed_off_at) per project. Signoff-chain data only — see file header for why the approval-proxy fallback in compute.ts is not reproduced here.';

-- --------------------------------------------------------------------------------------------
-- 4. First-time pass rate (R110) — mirrors compute.ts's "firstTimePassRate": % of itp_items whose
--    earliest inspection_record (by created_at) passed on the first attempt.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_first_time_pass_rate as
with first_attempts as (
  select distinct on (ir.itp_item_id)
    ir.itp_item_id,
    ir.project_id,
    ir.overall_result
  from public.inspection_records ir
  where ir.overall_result is not null
  order by ir.itp_item_id, ir.created_at asc
)
select
  p.organization_id,
  p.id as project_id,
  p.project_number,
  p.name as project_name,
  count(fa.itp_item_id) as first_attempts,
  count(fa.itp_item_id) filter (where fa.overall_result = 'pass') as first_time_passes,
  round(100.0 * count(fa.itp_item_id) filter (where fa.overall_result = 'pass') / nullif(count(fa.itp_item_id), 0), 1)
    as first_time_pass_rate_pct
from public.projects p
left join first_attempts fa on fa.project_id = p.id
group by p.organization_id, p.id, p.project_number, p.name;

comment on view public.vw_powerbi_first_time_pass_rate is
  'Power BI (R110): first-time pass rate per project (first inspection_record per itp_item that passed / total first attempts). Mirrors computeProjectKpis() in apps/web/lib/kpis/compute.ts.';

-- --------------------------------------------------------------------------------------------
-- 5. NCR trends (R110) — monthly NCR volume per project, broken out by severity and status, so
--    Power BI can chart trend lines the way compute.ts's "ncrCloseOutHours"/openItems data feeds
--    the client dashboard's NCR-related KPIs, but sliced for trending across all clients/projects.
-- --------------------------------------------------------------------------------------------
create or replace view public.vw_powerbi_ncr_trends as
select
  p.organization_id,
  n.project_id,
  p.project_number,
  p.name as project_name,
  date_trunc('month', n.created_at) as ncr_month,
  n.severity,
  n.status,
  count(*) as ncr_count,
  round(
    avg(extract(epoch from (n.closed_at - n.created_at)) / 3600.0)
      filter (where n.status = 'closed' and n.closed_at is not null),
    2
  ) as avg_close_out_hours
from public.ncrs n
join public.projects p on p.id = n.project_id
group by p.organization_id, n.project_id, p.project_number, p.name, date_trunc('month', n.created_at), n.severity, n.status;

comment on view public.vw_powerbi_ncr_trends is
  'Power BI (R110): monthly NCR volume and close-out time per project, by severity and status. Mirrors the NCR figures in computeProjectKpis() in apps/web/lib/kpis/compute.ts, aggregated for trending.';

-- --------------------------------------------------------------------------------------------
-- powerbi_reader role: a dedicated, narrowly-scoped LOGIN role for Power BI Desktop's direct
-- Postgres connector. LOGIN (not NOLOGIN) is required — Power BI connects as this role over the
-- network, it does not go through Supabase Auth/PostgREST/RLS at all, which is exactly why the
-- views above bake in organization_id/project_id columns instead of relying on has_org_access().
-- --------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    -- CHANGE THIS in the Supabase dashboard before sharing this role with anyone. This placeholder
    -- password is committed to source control and must never be used as the real credential — reset
    -- it from Supabase's dashboard (Database -> Roles, or `alter role powerbi_reader password '...'`
    -- run once from the SQL Editor with a real, secret value) before handing this role to Power BI
    -- or to anyone outside the team that manages this migration.
    create role powerbi_reader login password 'CHANGE_ME_placeholder_not_a_real_secret';
  end if;
end
$$;

-- Deliberately narrow: USAGE on the schema (required just to see objects in it) plus SELECT on
-- ONLY the five reporting views above. No table grants, no other schema, no INSERT/UPDATE/DELETE,
-- no function execute rights, nothing else — this role must never be able to read raw tenant data
-- (which has no RLS protection from this role's perspective, per the note above) or write anything.
grant usage on schema public to powerbi_reader;

grant select on
  public.vw_powerbi_inspections_completed_vs_planned,
  public.vw_powerbi_itp_completion,
  public.vw_powerbi_hold_point_turnaround,
  public.vw_powerbi_first_time_pass_rate,
  public.vw_powerbi_ncr_trends
to powerbi_reader;

comment on role powerbi_reader is
  'Power BI Desktop direct-Postgres connector role (R110). SELECT on the vw_powerbi_* reporting views only — no table access, no writes. Password is a placeholder; CHANGE THIS in the Supabase dashboard before sharing this role with anyone.';
