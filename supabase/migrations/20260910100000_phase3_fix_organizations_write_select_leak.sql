-- Fixes a real gap surfaced by live-testing an organisation-scoped inspector: `organizations_staff_write`
-- used `for all`, which in Postgres RLS applies to SELECT too (multiple permissive policies are OR'd
-- together) — so it silently bypassed `organizations_select`'s has_org_access(id) restriction for any
-- JAGS staff account, letting a scoped inspector see every organisation regardless of their grant.
-- `organizations_select` already exists and correctly restricts reads; this migration narrows the
-- staff policy to the write commands it actually needs (insert/update/delete), so it no longer
-- doubles as a SELECT bypass. Org creation/editing itself stays a blanket JAGS-staff action (not
-- org-scoped) — that's still correct, since a staff member has to be able to write a *brand new* org
-- row that, by definition, no grant could reference yet.
drop policy organizations_staff_write on public.organizations;

create policy organizations_staff_insert on public.organizations
  for insert
  with check (public.is_jags_staff());

create policy organizations_staff_update on public.organizations
  for update
  using (public.is_jags_staff())
  with check (public.is_jags_staff());

create policy organizations_staff_delete on public.organizations
  for delete
  using (public.is_jags_staff());

-- Same leak, same fix, on numbering_configs: its "for all" staff policy bypassed
-- numbering_configs_select's has_org_access(organization_id) restriction for any staff account.
-- Unlike organizations (which has no organization_id column on itself), numbering_configs rows
-- belong to one organisation, so the write policy can and should be scoped to it directly, same
-- pattern as the operational tables in the previous migration.
drop policy numbering_configs_staff_write on public.numbering_configs;

create policy numbering_configs_write on public.numbering_configs
  for all
  using (public.is_jags_staff() and public.has_org_access(organization_id))
  with check (public.is_jags_staff() and public.has_org_access(organization_id));
