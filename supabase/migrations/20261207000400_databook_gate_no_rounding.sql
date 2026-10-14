-- Data Book gate: a category with many rows could pass with outstanding items because the check was
-- round(ready*100/total) < 100 (199 of 200 rounded to 100). Strict rule: a category fails whenever
-- ready < total. Body is otherwise identical to the live definition; only the comparison changed.
-- Rollback: re-create the function with `round(r.ready::numeric * 100 / r.total) < 100` in place of `r.ready < r.total`.
create or replace function public.data_book_gate_failures(p_project_id uuid)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out text[] := '{}';
  v_n int;
  v_status text;
  r record;
begin
  select status into v_status from public.projects where id = p_project_id;
  if v_status is distinct from 'completed' then
    v_out := v_out || ('project status is ' || coalesce(v_status, 'unknown') || ', not completed');
  end if;
  select count(*) into v_n from public.punch_list_items where project_id = p_project_id and status <> 'closed';
  if v_n > 0 then v_out := v_out || (v_n || ' open punch item(s)'); end if;

  for r in select * from public.data_book_readiness_counts(p_project_id) loop
    if r.total > 0 and r.ready < r.total then
      v_out := v_out || (
        case r.category
          when 'ncrs' then (r.total - r.ready) || ' open NCR(s)'
          when 'itps' then (r.total - r.ready) || ' ITP(s) not approved'
          else r.label || ': ' || (r.total - r.ready) || ' of ' || r.total || ' outstanding'
        end);
    end if;
  end loop;
  return v_out;
end;
$function$;
