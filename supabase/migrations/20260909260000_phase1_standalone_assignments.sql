-- Phase 1: Standalone / FAT assignment mode (Reqs R7-R16).
-- QMP Inspect has two operating modes: the ITP-driven full lifecycle (projects/itps/... above),
-- and a standalone assignment — a single Factory Acceptance Test, witness inspection, specific
-- test, or pre-shipment check, done as a one-off with no ITP or data book required. The client's
-- own running example is "a FAT on a crusher": the generated report from this workspace IS the
-- deliverable, not a step feeding into a larger inspection record. Intentionally self-contained —
-- it does not reference itps/itp_items/inspection_records, by design (per the spec).
--
-- Same reasoning as ncrs_write in the NCR migration: this is shared work, not JAGS-staff-only.
-- A subcontractor's or vendor's own inspector is often the one actually running the FAT and filling
-- in measurements/photos/signatures, so RLS gates on tenant isolation (has_org_access) alone.

create table public.standalone_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Generated in the app as "{project_number}-{TYPE}-{seq}", not the DB — same approach as
  -- itp_number/ncr_number elsewhere in this schema.
  assignment_number text not null,
  assignment_type text not null
    check (assignment_type in ('fat', 'witness_inspection', 'specific_test', 'pre_shipment')),
  equipment_description text not null,
  manufacturer text,
  model text,
  serial_tag text,
  location text,
  standard_reference text,
  assignment_date date,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  conclusion text check (conclusion in ('pass', 'conditional_pass', 'fail')),
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, assignment_number)
);

create index standalone_assignments_project_id_idx on public.standalone_assignments (project_id);

create trigger standalone_assignments_set_updated_at
  before update on public.standalone_assignments
  for each row execute function public.set_updated_at();

create table public.standalone_assignment_measurements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.standalone_assignments (id) on delete cascade,
  description text not null,
  nominal_value text,
  tolerance text,
  actual_value text,
  unit text,
  result text check (result in ('pass', 'fail')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index standalone_assignment_measurements_assignment_id_idx
  on public.standalone_assignment_measurements (assignment_id);

create table public.standalone_assignment_photos (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.standalone_assignments (id) on delete cascade,
  -- Path in the "inspection-evidence" storage bucket, e.g. "standalone/{assignment_id}/{filename}".
  -- The file itself is uploaded client-side directly to Storage; this row only records where it
  -- landed, same split as everywhere else evidence is handled in this app.
  storage_path text not null,
  caption text,
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index standalone_assignment_photos_assignment_id_idx
  on public.standalone_assignment_photos (assignment_id);

create table public.standalone_assignment_punch_items (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.standalone_assignments (id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create index standalone_assignment_punch_items_assignment_id_idx
  on public.standalone_assignment_punch_items (assignment_id);

create table public.standalone_assignment_signatures (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.standalone_assignments (id) on delete cascade,
  role text not null,
  signatory_name text not null,
  -- Captured from a plain HTML5 canvas (pointer events, no signature-pad package) and stored as a
  -- data: URL PNG — small enough for this use case not to warrant a Storage object of its own.
  signature_data text not null,
  signed_at timestamptz not null default now()
);

create index standalone_assignment_signatures_assignment_id_idx
  on public.standalone_assignment_signatures (assignment_id);

alter table public.standalone_assignments enable row level security;
alter table public.standalone_assignment_measurements enable row level security;
alter table public.standalone_assignment_photos enable row level security;
alter table public.standalone_assignment_punch_items enable row level security;
alter table public.standalone_assignment_signatures enable row level security;

create policy standalone_assignments_select on public.standalone_assignments
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignments_write on public.standalone_assignments
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_measurements_select on public.standalone_assignment_measurements
  for select using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_measurements.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_measurements_write on public.standalone_assignment_measurements
  for all using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_measurements.assignment_id
        and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_measurements.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_photos_select on public.standalone_assignment_photos
  for select using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_photos.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_photos_write on public.standalone_assignment_photos
  for all using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_photos.assignment_id
        and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_photos.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_punch_items_select on public.standalone_assignment_punch_items
  for select using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_punch_items.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_punch_items_write on public.standalone_assignment_punch_items
  for all using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_punch_items.assignment_id
        and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_punch_items.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_signatures_select on public.standalone_assignment_signatures
  for select using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_signatures.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy standalone_assignment_signatures_write on public.standalone_assignment_signatures
  for all using (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_signatures.assignment_id
        and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.standalone_assignments a
      join public.projects p on p.id = a.project_id
      where a.id = standalone_assignment_signatures.assignment_id
        and public.has_org_access(p.organization_id)
    )
  );
