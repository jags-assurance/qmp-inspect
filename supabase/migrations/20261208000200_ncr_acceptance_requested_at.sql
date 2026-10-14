-- When the client was last asked to accept an NCR's disposition. Idempotent.
-- Rollback: alter table public.ncrs drop column if exists client_acceptance_requested_at;
alter table public.ncrs add column if not exists client_acceptance_requested_at timestamptz;

-- Backfill only rows still requiring acceptance and not yet stamped, from the latest audit event.
update public.ncrs n
set client_acceptance_requested_at = e.created_at
from (
  select distinct on (entity_id) entity_id, created_at
  from public.audit_log
  where entity_type = 'ncr' and action = 'client_acceptance_required'
  order by entity_id, created_at desc
) e
where e.entity_id = n.id
  and n.client_acceptance_requested_at is null
  and n.client_acceptance_required is true;
