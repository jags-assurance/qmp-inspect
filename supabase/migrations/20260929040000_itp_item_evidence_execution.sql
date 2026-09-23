-- ITP items with evidence_type = 2 (Document upload) or 3 (Measurement record) had no real
-- field-execution mechanism at all — only evidence_type = 1 (Checklist) did. The status page's own
-- comment says so plainly: "Only Checklist-type activities have a real field-execution flow today
-- — Document-upload and Measurement-record activities show as 'No execution flow yet' until that's
-- built, rather than a fabricated status." This is that build.

-- Measurement record: one flat row per measurement, mirroring standalone_assignment_measurements'
-- already-proven shape exactly (description/nominal/tolerance/actual/unit/result — free-text
-- nominal/tolerance/actual, no numeric typing enforced; comparison against tolerance is operator-
-- entered via `result`, same as standalone's) rather than inventing a second pattern for the same
-- kind of data.
create table public.itp_item_measurements (
  id uuid primary key default gen_random_uuid(),
  itp_item_id uuid not null references public.itp_items (id) on delete cascade,
  description text not null,
  nominal_value text,
  tolerance text,
  actual_value text,
  unit text,
  result text check (result in ('pass', 'fail')),
  sort_order int not null default 0,
  recorded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index itp_item_measurements_itp_item_id_idx on public.itp_item_measurements (itp_item_id);

-- Document-upload evidence: a many-to-many link to vault_documents — an item's evidence can be more
-- than one file (a submittal package, several scanned pages), unlike itp_items.
-- governing_drawing_document_id, which is a one-off single-FK "this item's governing drawing is
-- this one document" link and isn't reused here (that column means something different: which
-- drawing GOVERNS the activity, not what satisfies it as evidence).
create table public.itp_item_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  itp_item_id uuid not null references public.itp_items (id) on delete cascade,
  vault_document_id uuid not null references public.vault_documents (id) on delete cascade,
  linked_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (itp_item_id, vault_document_id)
);

create index itp_item_evidence_documents_itp_item_id_idx on public.itp_item_evidence_documents (itp_item_id);

alter table public.itp_item_measurements enable row level security;
alter table public.itp_item_evidence_documents enable row level security;

-- Same boundary as inspection_records/checklist_responses (20260922000200_consolidate_permissive_
-- policies_tier1.sql): RLS enforces tenant/project access only (has_project_access, or staff with
-- org access); the finer "only the party actually assigned to execute THIS activity may write"
-- rule is enforced at the application layer (lib/checklists/execution-parties.ts's
-- canExecuteItpItem, reused — not reimplemented — by the new measurement/evidence-document
-- actions), matching this schema's established split between "RLS = tenant isolation boundary" and
-- "app layer = finer business rule" for this exact class of table.
create policy itp_item_measurements_select on public.itp_item_measurements
  for select using (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_measurements.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy itp_item_measurements_write_i on public.itp_item_measurements
  for insert with check (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_measurements.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy itp_item_measurements_write_d on public.itp_item_measurements
  for delete using (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_measurements.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy itp_item_evidence_documents_select on public.itp_item_evidence_documents
  for select using (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_evidence_documents.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy itp_item_evidence_documents_write_i on public.itp_item_evidence_documents
  for insert with check (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_evidence_documents.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );

create policy itp_item_evidence_documents_write_d on public.itp_item_evidence_documents
  for delete using (
    exists (
      select 1
      from itp_items it
      join itp_sections s on s.id = it.section_id
      join itps i on i.id = s.itp_id
      join projects p on p.id = i.project_id
      where it.id = itp_item_evidence_documents.itp_item_id
        and (has_project_access(p.id, p.organization_id) or (is_jags_staff() and has_org_access(p.organization_id)))
    )
  );
