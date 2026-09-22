-- R20c — cloud folder sync (SharePoint/OneDrive), first slice.
--
-- No Microsoft Graph OAuth app registration exists to test a live sync against in this
-- environment (no MICROSOFT_GRAPH_CLIENT_ID/MICROSOFT_GRAPH_CLIENT_SECRET anywhere in this repo's
-- env). Rather than build a sync loop that can never be exercised, this ships the real, useful
-- first slice: a per-organisation saved configuration (which folder an Admin wants synced, and
-- which provider) plus an honest "not yet connected" gate in the UI (lib/cloud-sync/gate.ts,
-- mirroring lib/ai/gate.ts's isAiConfigured pattern) until real OAuth credentials exist. The
-- actual Graph API polling/webhook sync is left as a clearly-documented next step — see
-- lib/cloud-sync/gate.ts's header comment for exactly what it would need.
--
-- One row per organisation (not per-project) — same granularity as itp_approval_workflow_configs
-- (20260922060000) and organization_plans, and a config an Admin can freely overwrite (a fresh
-- provider/folder choice simply upserts over the old one) rather than a history table, since only
-- the current target folder is ever meaningful.
create table public.cloud_folder_sync_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('sharepoint', 'onedrive')),
  -- A pasted SharePoint/OneDrive folder URL or Graph drive-item ID — deliberately just a free-text
  -- reference, not something this migration can validate without calling Graph, matching how this
  -- slice stays configuration-only until real credentials exist.
  folder_reference text not null,
  connected_by uuid references public.users (id),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cloud_folder_sync_configs_set_updated_at
  before update on public.cloud_folder_sync_configs
  for each row execute function public.set_updated_at();

alter table public.cloud_folder_sync_configs enable row level security;

-- Read access to any party with org access, same as itp_approval_workflow_configs_select — needed
-- so a non-admin can at least see what's configured (or that nothing is) when this eventually
-- surfaces status in the Document Vault UI.
create policy cloud_folder_sync_configs_select on public.cloud_folder_sync_configs
  for select using (public.has_org_access(organization_id));

-- Configuring an external cloud-storage integration is an administrative act, same boundary as
-- numbering/intervention levels/ITP approval workflow — JAGS Admin only, and still requires org
-- access so an Admin can't blindly write rows for an org they hold no grant to.
create policy cloud_folder_sync_configs_admin_write on public.cloud_folder_sync_configs
  for all
  using (public.is_jags_staff() and public.has_org_access(organization_id))
  with check (public.is_jags_staff() and public.has_org_access(organization_id));
