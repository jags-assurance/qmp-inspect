-- Per-organisation Document Vault upload size limit (MB). The default is 50 MB; a JAGS Admin can set any
-- whole number from 1 to 500 per organisation (500 is the Storage bucket ceiling, see
-- 20261127000400_inspection_evidence_file_size_limit.sql). Rows are only written when an Admin changes the
-- limit; an organisation without a row uses the 50 MB default in code.
--
-- Readers: the upload form and the upload server action read the limit (the action uses the service role so
-- an external uploader gets their organisation's limit without table access). Writers: JAGS Admins only.
-- Does not edit earlier migrations. Requires has_org_access(), is_jags_staff(), is_admin_staff().

create table if not exists public.org_vault_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  max_upload_mb integer not null default 50 check (max_upload_mb between 1 and 500),
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_vault_settings enable row level security;

drop policy if exists org_vault_settings_select on public.org_vault_settings;
create policy org_vault_settings_select on public.org_vault_settings for select using (
  public.is_jags_staff() and public.has_org_access(organization_id)
);

drop policy if exists org_vault_settings_insert on public.org_vault_settings;
create policy org_vault_settings_insert on public.org_vault_settings for insert with check (
  public.is_admin_staff() and public.has_org_access(organization_id)
);

drop policy if exists org_vault_settings_update on public.org_vault_settings;
create policy org_vault_settings_update on public.org_vault_settings for update
  using (public.is_admin_staff() and public.has_org_access(organization_id))
  with check (public.is_admin_staff() and public.has_org_access(organization_id));

-- No delete policy: set the limit back to 50 instead.
