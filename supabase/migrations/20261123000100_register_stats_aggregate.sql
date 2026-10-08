-- NCR / Observation register stat cards as ONE SQL aggregate.
-- The register pages used to page every matching row (status, due_date, created_at) to the web server in
-- 1000-row slices and count in JavaScript. This returns the same numbers in one round trip.
--
-- SECURITY INVOKER on purpose: row-level security on ncrs applies exactly as it does for the table query, so
-- a caller only ever counts rows they can see.
--
--   p_observations  true = the Observation register (severity = 'observation'); false = the NCR register
--                   (every other severity, optionally narrowed by p_severity).
--   p_itp_item_ids  null = no discipline filter; an array (even empty) = only NCRs linked to those ITP items.
--   p_assignee      'me' (needs p_user_id) | 'unassigned' | null.
--   p_today         the site's calendar date (overdue = open with due_date strictly before it).
--   p_now           reference instant for ages (whole days since created_at, floored).
-- Returns jsonb: total, open, closed, overdue, status_counts {status: n}, aging [0-7, 8-14, 15-30, 30+] over
-- open rows. The status/overdue chip filters are intentionally NOT parameters: the chips always show totals.
-- Forward-only and idempotent.

create or replace function public.register_stats(
  p_observations boolean,
  p_project_id uuid default null,
  p_severity text default null,
  p_assignee text default null,
  p_user_id uuid default null,
  p_itp_item_ids uuid[] default null,
  p_today date default current_date,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with rows as (
    select n.status, n.due_date,
           floor(extract(epoch from (p_now - n.created_at)) / 86400)::int as age_days
    from public.ncrs n
    where (case when p_observations then n.severity = 'observation' else n.severity <> 'observation' end)
      and (p_observations or p_severity is null or p_severity not in ('minor_ncr', 'major_ncr') or n.severity = p_severity)
      and (p_project_id is null or n.project_id = p_project_id)
      and (p_itp_item_ids is null or n.itp_item_id = any (p_itp_item_ids))
      and (
        p_assignee is null
        or (p_assignee = 'me' and p_user_id is not null and n.assigned_to = p_user_id)
        or (p_assignee = 'unassigned' and n.assigned_to is null)
        or p_assignee not in ('me', 'unassigned')
      )
  ),
  by_status as (
    select status, count(*)::int as n from rows group by status
  )
  select jsonb_build_object(
    'total',   (select count(*) from rows),
    'open',    (select count(*) from rows where status <> 'closed'),
    'closed',  (select count(*) from rows where status = 'closed'),
    'overdue', (select count(*) from rows where status <> 'closed' and due_date is not null and due_date < p_today),
    'status_counts', coalesce((select jsonb_object_agg(status, n) from by_status), '{}'::jsonb),
    'aging', jsonb_build_array(
      (select count(*) from rows where status <> 'closed' and age_days <= 7),
      (select count(*) from rows where status <> 'closed' and age_days > 7 and age_days <= 14),
      (select count(*) from rows where status <> 'closed' and age_days > 14 and age_days <= 30),
      (select count(*) from rows where status <> 'closed' and age_days > 30)
    )
  );
$$;

revoke all on function public.register_stats(boolean, uuid, text, text, uuid, uuid[], date, timestamptz) from public, anon;
grant execute on function public.register_stats(boolean, uuid, text, text, uuid, uuid[], date, timestamptz) to authenticated, service_role;
