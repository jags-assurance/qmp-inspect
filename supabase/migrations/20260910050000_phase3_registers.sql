-- Phase 3: vault-generated registers (calibration / welder qualification / material) that ITP
-- field execution can be verified against (Reqs R92-R100).
--
-- These are ordinary project data, maintained by whichever project party is tracking them —
-- unlike itp_items/checklist_templates (ITP *content*, staff-only), this is closer to
-- inspection_records/checklist_responses: gated on tenant isolation (has_org_access) alone, not
-- is_jags_staff().
--
-- `status` is a stored column (kept for explicit UI coloring/filtering) but is NOT maintained by a
-- trigger or scheduled job in this phase — it's recomputed at read time from today's date and the
-- relevant date column by apps/web/lib/registers/refresh.ts, which updates any row whose stored
-- status has gone stale. A cron-driven approach was considered and rejected as unnecessary for
-- this phase (see that file).

create table public.calibration_register (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  instrument_name text not null,
  cert_number text not null,
  cal_date date,
  due_date date not null,
  status text not null default 'valid' check (status in ('valid', 'due_soon', 'expired')),
  notes text,
  created_at timestamptz not null default now()
);

create index calibration_register_project_id_idx on public.calibration_register (project_id);

create table public.welder_qualification_register (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  welder_identifier text not null,
  qualified_wps text not null,
  qualified_ranges text,
  expiry_date date not null,
  status text not null default 'valid' check (status in ('valid', 'expiring', 'expired')),
  notes text,
  created_at timestamptz not null default now()
);

create index welder_qualification_register_project_id_idx
  on public.welder_qualification_register (project_id);

create table public.material_register (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  material_description text not null,
  submittal_reference text,
  -- Standard construction-submittal approval coding: A = approved, B = approved as noted,
  -- C = revise and resubmit, D = rejected.
  approval_status text not null check (approval_status in ('A', 'B', 'C', 'D')),
  approved_date date,
  notes text,
  created_at timestamptz not null default now()
);

create index material_register_project_id_idx on public.material_register (project_id);

alter table public.calibration_register enable row level security;
alter table public.welder_qualification_register enable row level security;
alter table public.material_register enable row level security;

create policy calibration_register_select on public.calibration_register
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = calibration_register.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy calibration_register_write on public.calibration_register
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = calibration_register.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = calibration_register.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy welder_qualification_register_select on public.welder_qualification_register
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = welder_qualification_register.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy welder_qualification_register_write on public.welder_qualification_register
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = welder_qualification_register.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = welder_qualification_register.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy material_register_select on public.material_register
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = material_register.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy material_register_write on public.material_register
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = material_register.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = material_register.project_id and public.has_org_access(p.organization_id)
    )
  );
