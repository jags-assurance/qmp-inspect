-- MANUAL, one-off data fixes for the dev database. NOT a migration: it is not applied automatically.
-- Run it in the Supabase SQL editor of the project behind jags-qmp-client-dev.vercel.app.
-- Everything is inside one transaction; read the SELECT output in step 1 before running step 2/3
-- (run step 1 alone first, then the whole file).

begin;

-- 1) DIAGNOSE: why does inspector.scoped@jagsassurance.local see every organisation's projects?
--    It should hold only an organisation-scoped grant for Meridian Energy (plus the project-scoped
--    TPI grant created by reassigning a party to it). A 'global' row here is the cause.
select u.email, g.scope_type, g.organization_id, g.project_id, g.role
from public.access_grants g
join public.users u on u.id = g.user_id
where u.email in ('inspector.scoped@jagsassurance.local', 'inspector@jagsassurance.local')
order by u.email, g.scope_type;

-- 2) FIX: remove any GLOBAL grant from the scoped demo inspector only. The global inspector
--    (inspector@jagsassurance.local) is not touched. Its organisation/project-scoped grants stay.
delete from public.access_grants g
using public.users u
where g.user_id = u.id
  and u.email = 'inspector.scoped@jagsassurance.local'
  and g.scope_type = 'global';

-- Safety net: make sure it still has its Meridian Energy organisation grant after the delete.
insert into public.access_grants (user_id, scope_type, organization_id, role)
select u.id, 'organization', o.id, 'inspector'
from public.users u, public.organizations o
where u.email = 'inspector.scoped@jagsassurance.local'
  and o.name = 'Meridian Energy'
  and not exists (
    select 1 from public.access_grants g
    where g.user_id = u.id and g.scope_type = 'organization' and g.organization_id = o.id
  );

-- 3) CLEAN UP the test records created by the automated live UI checks (all tagged "[UI-TEST").
delete from public.punch_list_items
where source_ncr_id in (select id from public.ncrs where description like '[UI-TEST%');

delete from public.ncr_photos
where ncr_id in (select id from public.ncrs where description like '[UI-TEST%');

delete from public.ncrs where description like '[UI-TEST%';

-- 4) VERIFY (should show no 'global' row for the scoped inspector and 0 remaining test records).
select 'scoped inspector global grants' as check, count(*)::int as n
from public.access_grants g join public.users u on u.id = g.user_id
where u.email = 'inspector.scoped@jagsassurance.local' and g.scope_type = 'global'
union all
select 'remaining [UI-TEST] NCRs', count(*)::int from public.ncrs where description like '[UI-TEST%';

commit;
