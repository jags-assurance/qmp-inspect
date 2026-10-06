-- Audit trail for master ITP template administration (metadata edits, retire / reactivate).
create table if not exists public.itp_master_audit (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.itp_master_templates (id) on delete cascade,
  action text not null check (action in ('metadata_edited', 'retired', 'reactivated')),
  actor_id uuid references public.users (id),
  summary text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists itp_master_audit_template_idx on public.itp_master_audit (template_id, created_at desc);
create index if not exists itp_master_audit_actor_idx on public.itp_master_audit (actor_id);

alter table public.itp_master_audit enable row level security;

create policy itp_master_audit_staff_select on public.itp_master_audit
  for select using (public.is_jags_staff());

create policy itp_master_audit_staff_insert on public.itp_master_audit
  for insert with check (public.is_jags_staff());
