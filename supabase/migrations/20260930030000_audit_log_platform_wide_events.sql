-- Closes the global-staff-access audit gap: granting or revoking a GLOBAL-scope access_grants row
-- (the single most sensitive permission in the app — access to every organisation) had no audit
-- trail at all, because recordAuditEvent requires a non-null organization_id and a global grant has
-- no one organisation to attach it to.
--
-- organization_id becomes nullable, meaning "platform-wide event, not scoped to any one
-- organisation" — the exact same convention this table's own project_id column already uses one
-- level down ("some events are org-level rather than project-scoped"). A platform-wide event is
-- inherently a JAGS-staff-only concern (a client should never see "global staff access granted" —
-- it says nothing about their own organisation), so both RLS policies gate the null-org case on
-- is_jags_staff() instead of has_org_access(), rather than picking an arbitrary organisation_id to
-- attach it to (which would also mean inventing a fake "platform" organizations row that leaks into
-- every client-facing org list/picker in the app — the null-column route avoids that entirely).

alter table public.audit_log
  alter column organization_id drop not null;

drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using (
    (organization_id is not null and public.has_org_access(organization_id))
    or (organization_id is null and public.is_jags_staff())
  );

drop policy audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    (organization_id is not null and public.has_org_access(organization_id))
    or (organization_id is null and public.is_jags_staff())
  );
