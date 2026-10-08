-- Local record of `revoke_trigger_function_execute`, which is already live but had no file.
-- Trigger functions are invoked by the trigger machinery, which does not check the caller's EXECUTE
-- privilege, so signed-in and anonymous users never need it. Left granted, every trigger function in
-- public is also exposed as a callable /rest/v1/rpc/<name> endpoint.
-- Revokes EXECUTE on every function in public that returns `trigger` from PUBLIC, anon and
-- authenticated. Idempotent; re-running after a new trigger function is added closes it too.
-- If the live version of this migration differs, keep the live behaviour: this one only ever removes
-- privileges from trigger functions.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end
$$;
