-- Default sign-off level per PARTY TYPE on each master-template activity; applied to the matching parties
-- when a project ITP is created from the template.
create table if not exists public.itp_master_item_interventions (
  id uuid primary key default gen_random_uuid(),
  master_item_id uuid not null references public.itp_master_items (id) on delete cascade,
  party_type text not null,
  intervention text not null,
  created_at timestamptz not null default now(),
  unique (master_item_id, party_type)
);
create index if not exists itp_master_item_interventions_item_idx on public.itp_master_item_interventions (master_item_id);
alter table public.itp_master_item_interventions enable row level security;
create policy itp_master_item_interventions_select on public.itp_master_item_interventions
  for select using (public.is_jags_staff());
create policy itp_master_item_interventions_write on public.itp_master_item_interventions
  for all using (public.is_admin_staff()) with check (public.is_admin_staff());

-- A change to an issued ITP creates a new revision that must be approved again.
alter table public.itps
  add column if not exists revision_needs_approval boolean not null default false,
  add column if not exists revision_changed_by uuid;
