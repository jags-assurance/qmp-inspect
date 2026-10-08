-- Phase 5 / S3-11: replacing a register entry's certificate file keeps the previous file on record.
-- The storage object itself is never deleted by the app; this table remembers which path each entry used
-- before, who replaced it, when and why. Idempotent. Does not edit earlier migrations.

create table if not exists public.register_certificate_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  register_kind text not null check (register_kind in ('calibration', 'welder', 'material', 'personnel')),
  entry_id uuid not null,
  old_path text not null,
  new_path text,
  reason text,
  replaced_by uuid references public.users (id) on delete set null,
  replaced_at timestamptz not null default now()
);

create index if not exists register_certificate_history_entry_idx
  on public.register_certificate_history (register_kind, entry_id, replaced_at desc);
create index if not exists register_certificate_history_project_idx
  on public.register_certificate_history (project_id);

alter table public.register_certificate_history enable row level security;

drop policy if exists register_certificate_history_select on public.register_certificate_history;
create policy register_certificate_history_select on public.register_certificate_history for select using (
  exists (
    select 1 from public.projects p
    where p.id = register_certificate_history.project_id and public.has_project_access(p.id, p.organization_id)
  )
);

-- Only JAGS staff replace certificate files (editing register rows is staff-only), and only as themselves.
drop policy if exists register_certificate_history_insert on public.register_certificate_history;
create policy register_certificate_history_insert on public.register_certificate_history for insert with check (
  public.is_jags_staff()
  and replaced_by = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = register_certificate_history.project_id and public.has_project_access(p.id, p.organization_id)
  )
);

-- History rows are a record: no update or delete policy exists, so none is allowed.
