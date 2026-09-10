-- Phase 1: checklists, field execution, inspection records, and IRN issuance (Reqs R44-R65).
-- The loop this migration exists for: an approved ITP activity with evidence_type = 1 gets a
-- numbered checklist generated -> a field user fills it in (Yes/No/N-A + comment + photos +
-- signature) -> completing it freezes an inspection_records row -> a PASS result lets an IRN
-- (Inspection Release Note) be issued off that record.
--
-- Checklists are generated and numbered at ITP APPROVAL, not at draft (R48). That generation step
-- lives in the app (see apps/web/lib/checklists/actions.ts), not a trigger on itps.status, so it
-- stays a deliberate, visible action rather than something that silently fires as a side effect of
-- an unrelated status-advance mutation.
--
-- checklist_templates/checklist_items are ITP *content* (defining what to check) and are gated
-- staff-only, mirroring itp_items_staff_write. inspection_records/checklist_responses/
-- inspection_photos/irns are field *execution* data — filled in by whichever project party
-- (subcontractor, main contractor, TPI/lab, JAGS) is actually doing the inspection — so, like
-- ncrs_write, those gate on tenant isolation (has_org_access) alone, not is_jags_staff().
--
-- inspection_records freezes project_name/itp_number/activity as plain text columns at creation
-- time (not just FKs) so the traceability header on a historical record reads correctly even if
-- the project is renamed or the ITP activity wording is later edited.

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  -- One checklist per evidence_type = 1 activity — generated once, at ITP approval.
  itp_item_id uuid not null references public.itp_items (id) on delete cascade unique,
  -- Generated in the app as "{itp_number}-CHK-{seq}", same approach as other human-facing document
  -- numbers in this schema (e.g. itp_number, ncr_number).
  checklist_number text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates (id) on delete cascade,
  item_number text not null,
  description text not null,
  is_mandatory boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (template_id, item_number)
);

create index checklist_items_template_id_idx on public.checklist_items (template_id);

-- overall_result is nullable: a record exists (and can already carry responses/photos) from the
-- moment the field user starts an inspection, but is only "pass"/"fail"/"partial" once they
-- complete it — that's the one deviation from the literal spec shape (adding a null/in-progress
-- state to overall_result) and it's needed because photos and responses must attach to a real
-- inspection_record row before completion, not only after.
create table public.inspection_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  itp_item_id uuid not null references public.itp_items (id) on delete cascade,
  checklist_template_id uuid references public.checklist_templates (id) on delete set null,
  -- Generated in the app as "{itp_number}-INSP-{seq}".
  record_number text not null,
  -- Traceability header, frozen at creation time — see file header note.
  project_name text not null,
  itp_number text not null,
  activity text not null,
  location text,
  inspection_date date not null default current_date,
  inspector_id uuid references public.users (id),
  -- A data URL (canvas signature pad) or a Supabase Storage path — either is a plain string.
  inspector_signature text,
  overall_result text check (overall_result in ('pass', 'fail', 'partial')),
  notes text,
  created_at timestamptz not null default now(),
  unique (project_id, record_number)
);

create index inspection_records_project_id_idx on public.inspection_records (project_id);
create index inspection_records_itp_item_id_idx on public.inspection_records (itp_item_id);

create table public.checklist_responses (
  id uuid primary key default gen_random_uuid(),
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  checklist_item_id uuid not null references public.checklist_items (id) on delete cascade,
  result text not null check (result in ('yes', 'no', 'na')),
  comment text,
  created_at timestamptz not null default now(),
  unique (inspection_record_id, checklist_item_id)
);

create index checklist_responses_record_id_idx on public.checklist_responses (inspection_record_id);

create table public.inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_record_id uuid not null references public.inspection_records (id) on delete cascade,
  storage_path text not null,
  caption text,
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index inspection_photos_record_id_idx on public.inspection_photos (inspection_record_id);

create table public.irns (
  id uuid primary key default gen_random_uuid(),
  inspection_record_id uuid not null unique references public.inspection_records (id) on delete cascade,
  -- Generated in the app as "{itp_number}-IRN-{seq}" — a simple per-ITP counter, not guaranteed
  -- collision-proof under concurrent issuance, which is an acceptable trade-off for this phase.
  irn_number text not null,
  release_date date not null default current_date,
  issued_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

alter table public.checklist_templates enable row level security;
alter table public.checklist_items enable row level security;
alter table public.inspection_records enable row level security;
alter table public.checklist_responses enable row level security;
alter table public.inspection_photos enable row level security;
alter table public.irns enable row level security;

create policy checklist_templates_select on public.checklist_templates
  for select using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = checklist_templates.itp_item_id and public.has_org_access(p.organization_id)
    )
  );

-- Defining a checklist (generating it, adding/editing its items) is ITP content management —
-- staff-only, matching itp_items_staff_write.
create policy checklist_templates_staff_write on public.checklist_templates
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy checklist_items_select on public.checklist_items
  for select using (
    exists (
      select 1 from public.checklist_templates t
      join public.itp_items it on it.id = t.itp_item_id
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where t.id = checklist_items.template_id and public.has_org_access(p.organization_id)
    )
  );

create policy checklist_items_staff_write on public.checklist_items
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy inspection_records_select on public.inspection_records
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = inspection_records.project_id and public.has_org_access(p.organization_id)
    )
  );

-- Deliberately not staff-only (contrast with checklist_templates_staff_write): filling in and
-- submitting a checklist / inspection record is field execution work done by whichever project
-- party is actually doing the inspection, not only JAGS staff. The boundary that matters here is
-- tenant isolation, same reasoning as ncrs_write.
create policy inspection_records_write on public.inspection_records
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = inspection_records.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = inspection_records.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy checklist_responses_select on public.checklist_responses
  for select using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = checklist_responses.inspection_record_id and public.has_org_access(p.organization_id)
    )
  );

create policy checklist_responses_write on public.checklist_responses
  for all using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = checklist_responses.inspection_record_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = checklist_responses.inspection_record_id and public.has_org_access(p.organization_id)
    )
  );

create policy inspection_photos_select on public.inspection_photos
  for select using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_photos.inspection_record_id and public.has_org_access(p.organization_id)
    )
  );

create policy inspection_photos_write on public.inspection_photos
  for all using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_photos.inspection_record_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = inspection_photos.inspection_record_id and public.has_org_access(p.organization_id)
    )
  );

create policy irns_select on public.irns
  for select using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = irns.inspection_record_id and public.has_org_access(p.organization_id)
    )
  );

create policy irns_write on public.irns
  for all using (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = irns.inspection_record_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.inspection_records r
      join public.projects p on p.id = r.project_id
      where r.id = irns.inspection_record_id and public.has_org_access(p.organization_id)
    )
  );
