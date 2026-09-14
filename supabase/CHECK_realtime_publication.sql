-- Run this on its own in the Supabase SQL Editor and look at the result grid it produces.

-- Step 1: re-apply (safe to run again — ADD TABLE on an already-added table just errors harmlessly,
-- which this catches and ignores per table so one already-added table doesn't stop the rest).
do $$
declare
  t text;
begin
  foreach t in array array['notifications', 'activity_signoff_progress', 'itps', 'ncrs', 'checklist_responses']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added %', t;
    exception when duplicate_object then
      raise notice '% already present', t;
    end;
  end loop;
end $$;

-- Step 2: THE thing to actually look at — run this as its own statement (select it and hit Run, or
-- just look at the result grid after running the whole file) to see what's really registered.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
