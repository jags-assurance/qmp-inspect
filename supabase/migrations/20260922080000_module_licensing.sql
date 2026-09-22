-- R112: per-client module licensing — a fixed set of real feature areas (ITPs, NCRs,
-- Observations, Document Vault, Standalone Assignments, Registers, Data Book, Handover, Client
-- Teams, Custom Roles, Reporting, Power BI) that a JAGS Admin can individually license on or off
-- per organisation. This is a distinct concern from `organization_plans` (supabase/migrations/
-- 20260917070000_org_plans_and_seat_limit.sql), which is seat-count/tier capacity, not feature
-- access — an org can be fully within its seat limit and still not be licensed for, say, Power BI.
--
-- module_key is constrained to the app's actual current nav-driven feature set (see
-- apps/web/app/inspect/layout.tsx's navItems for the authoritative list at the time this was
-- written) rather than an open text column, so a typo'd key can never silently create a dead
-- license row nobody's UI ever reads.
--
-- DEFAULT-LICENSED BEHAVIOUR: this app has zero paying customers today. A missing
-- (organization_id, module_key) row means "licensed" — only an explicit is_licensed = false row
-- revokes a module. This is enforced both by the column default (true) and, more importantly, by
-- apps/web/lib/module-licensing/access.ts's helper, which treats "no row found" (or any query
-- error) as licensed = true. Shipping this any other way (default-deny) would silently lock every
-- existing org out of every module the instant this migration ran.
create table public.organization_module_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  module_key text not null check (module_key in (
    'itps',
    'ncrs',
    'observations',
    'vault',
    'standalone_assignments',
    'registers',
    'data_book',
    'handover',
    'client_teams',
    'custom_roles',
    'reporting',
    'power_bi'
  )),
  is_licensed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module_key)
);

create index organization_module_licenses_org_idx on public.organization_module_licenses (organization_id);

alter table public.organization_module_licenses enable row level security;

-- Any user with access to the org can see what it's licensed for (needed to render/gate their own
-- nav and pages) — same read-gate shape as intervention_level_types_select.
create policy organization_module_licenses_select on public.organization_module_licenses
  for select using (public.has_org_access(organization_id));

-- Only a JAGS Admin manages licensing (not any staff — a plain Inspector has no business turning a
-- client's modules on/off). Deliberately is_admin_staff(), not the broader is_jags_staff(), per the
-- task spec — mirrors intervention_level_types_admin_write / numbering's admin-only write gate.
create policy organization_module_licenses_admin_write on public.organization_module_licenses
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());

create or replace function public.set_organization_module_licenses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organization_module_licenses_set_updated_at
  before update on public.organization_module_licenses
  for each row execute function public.set_organization_module_licenses_updated_at();
