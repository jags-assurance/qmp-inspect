-- KPI / dashboard aggregates: counts the web app used to compute by paging whole tables into memory.
-- All SECURITY INVOKER so row-level security applies exactly as for the table queries (a caller only
-- counts rows they can see). Read-only, forward-only, idempotent (create or replace).
--
--   kpi_monthly_counts(project)   NCRs + completed inspection records per UTC calendar month
--   kpi_punch_by_source(project)  punch items per source, open (status <> 'closed') vs closed
--   kpi_party_rollup(project)     per project party: sign-off rows total / signed_off, and NCRs against it
--   kpi_open_ncrs_by_project()    open non-observation NCRs per project with the project's organisation
--
-- Rollback: drop function if exists public.kpi_monthly_counts(uuid), public.kpi_punch_by_source(uuid),
--   public.kpi_party_rollup(uuid), public.kpi_open_ncrs_by_project();
-- (The app falls back to nothing: revert the matching app commit first, or the pages will error.)

create or replace function public.kpi_monthly_counts(p_project_id uuid)
returns table (year int, month0 int, ncr_count bigint, inspection_count bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with n as (
    select extract(year from created_at at time zone 'UTC')::int as y,
           extract(month from created_at at time zone 'UTC')::int - 1 as m, count(*) as c
    from public.ncrs where project_id = p_project_id group by 1, 2
  ), i as (
    select extract(year from created_at at time zone 'UTC')::int as y,
           extract(month from created_at at time zone 'UTC')::int - 1 as m, count(*) as c
    from public.inspection_records
    where project_id = p_project_id and overall_result is not null group by 1, 2
  )
  select coalesce(n.y, i.y), coalesce(n.m, i.m), coalesce(n.c, 0), coalesce(i.c, 0)
  from n full join i on n.y = i.y and n.m = i.m;
$$;

create or replace function public.kpi_punch_by_source(p_project_id uuid)
returns table (source text, open_count bigint, closed_count bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select source::text,
         count(*) filter (where status <> 'closed'),
         count(*) filter (where status = 'closed')
  from public.punch_list_items where project_id = p_project_id group by source;
$$;

create or replace function public.kpi_party_rollup(p_project_id uuid)
returns table (party_id uuid, signoff_total bigint, signoff_signed_off bigint, ncr_count bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with s as (
    select a.project_party_id as pid, count(*) as total,
           count(*) filter (where a.status = 'signed_off') as done
    from public.activity_signoff_progress a
    join public.itp_items it on it.id = a.itp_item_id
    join public.itp_sections sec on sec.id = it.section_id
    join public.itps i on i.id = sec.itp_id
    where i.project_id = p_project_id
    group by a.project_party_id
  ), n as (
    select responsible_party_id as pid, count(*) as c
    from public.ncrs
    where project_id = p_project_id and responsible_party_id is not null
    group by responsible_party_id
  )
  select coalesce(s.pid, n.pid), coalesce(s.total, 0), coalesce(s.done, 0), coalesce(n.c, 0)
  from s full join n on s.pid = n.pid;
$$;

create or replace function public.kpi_open_ncrs_by_project()
returns table (project_id uuid, organization_id uuid, open_count bigint)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select n.project_id, p.organization_id, count(*)
  from public.ncrs n
  left join public.projects p on p.id = n.project_id
  where n.status <> 'closed' and coalesce(n.severity, '') <> 'observation'
  group by n.project_id, p.organization_id;
$$;

grant execute on function public.kpi_monthly_counts(uuid), public.kpi_punch_by_source(uuid),
  public.kpi_party_rollup(uuid), public.kpi_open_ncrs_by_project() to authenticated, service_role;
