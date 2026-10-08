-- Filter options for the project audit log (distinct categories and people) as a SQL DISTINCT.
-- The page used to read the latest 1000 audit rows and de-duplicate them in JavaScript, which was both
-- a wasted scan on every view and WRONG for busy projects (a category or person older than the latest
-- 1000 events never appeared in the filter). SECURITY INVOKER: audit_log RLS applies as for the log itself.
-- The two indexes make the DISTINCT an index-only walk per project. Forward-only and idempotent.

create index if not exists audit_log_project_entity_type_idx on public.audit_log (project_id, entity_type);
create index if not exists audit_log_project_actor_idx on public.audit_log (project_id, actor_id);

create or replace function public.audit_log_facets(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(entity_type order by entity_type)
      from (select distinct entity_type from public.audit_log where project_id = p_project_id) c
    ), '[]'::jsonb),
    'actors', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.actor_id, 'name', coalesce(u.full_name, 'Unknown')) order by coalesce(u.full_name, 'Unknown'))
      from (select distinct actor_id from public.audit_log where project_id = p_project_id and actor_id is not null) a
      left join public.users u on u.id = a.actor_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.audit_log_facets(uuid) from public, anon;
grant execute on function public.audit_log_facets(uuid) to authenticated, service_role;
