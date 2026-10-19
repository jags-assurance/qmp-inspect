-- Admin-editable terminology: lets a JAGS Admin rename key terms (the field role, "Observation", "NCR")
-- from Settings > Terminology instead of the names being hard-coded. Labels only: database values,
-- routes and enum values (e.g. staff_role 'inspector', severity 'observation') are NOT changed.
-- NOT applied automatically; dev and prod share one database, so apply deliberately.
--
-- Platform-wide (JAGS-level): there is exactly one row (id is always true). `terms` is a JSON object
-- keyed by term key, e.g. {"field_engineer": {"singular": "Site Engineer", "plural": "Site Engineers"}}.
-- A key that is absent uses the built-in default. The app falls back to the defaults when this table
-- does not exist yet.
create table if not exists public.terminology_settings (
  id boolean primary key default true check (id),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

alter table public.terminology_settings enable row level security;

-- Every signed-in user reads the labels (they are shown throughout the app); only an Admin writes.
drop policy if exists terminology_settings_read on public.terminology_settings;
create policy terminology_settings_read on public.terminology_settings
  for select to authenticated using (true);

drop policy if exists terminology_settings_admin_write on public.terminology_settings;
create policy terminology_settings_admin_write on public.terminology_settings
  for all to authenticated
  using (public.is_admin_staff())
  with check (public.is_admin_staff());

insert into public.terminology_settings (id) values (true) on conflict (id) do nothing;
