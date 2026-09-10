-- Phase 3: "expected -> received" tracking for third-party test records/reports (R54-R56).
-- Records/Evidence per activity is a live list of expected records, each showing what it is, who
-- provides it (Jags / TPI / Contractor), its number, and its status (pending / received). Jags
-- checklists/reports (R55) are already auto-generated+numbered via checklist_templates/irns, and
-- "other system reports" (R57) are numbered the same way — neither needs a new table. This
-- migration only covers the R56 case: a record a THIRD PARTY issues outside the app (e.g. a TPI lab
-- test certificate, a mill cert), which starts out listed with a blank number and gets filled in
-- (document number + uploaded file) once actually received.
create table public.activity_expected_records (
  id uuid primary key default gen_random_uuid(),
  itp_item_id uuid not null references public.itp_items (id) on delete cascade,
  -- Who is expected to provide this record. 'jags' is included even though R55's own Jags
  -- checklists/reports are tracked elsewhere, because a Jags-provided record can still be
  -- pre-listed here as "expected" ahead of the checklist existing (e.g. planning-stage callouts).
  provider text not null check (provider in ('jags', 'tpi', 'contractor')),
  record_type text not null,
  -- Left blank at creation ("expected") per R56; filled in only when the third party issues the
  -- actual document.
  document_number text,
  storage_path text,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create index activity_expected_records_item_idx on public.activity_expected_records (itp_item_id);

alter table public.activity_expected_records enable row level security;

-- Same has_org_access-via-project-join pattern used throughout (see activity_signoff_progress_select
-- in 20260910000000_phase1_signoff_chain.sql) — anyone with tenant access to the project can see the
-- outstanding/received list; that visibility itself is the audit trail R56 asks for.
create policy activity_expected_records_select on public.activity_expected_records
  for select using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_expected_records.itp_item_id
        and public.has_org_access(p.organization_id)
    )
  );

-- Writes: JAGS staff can always create/edit the expected-record list (it's set up at ITP creation,
-- staff territory, mirroring itp_items_staff_write) OR the specific party this row's `provider`
-- names, but only if that party is actually linked to a login on this project via
-- project_parties.user_id (mirrors canSignOffForParty in lib/signoff/actions.ts) — that's who
-- would legitimately be marking their own record received. provider 'jags' has no such party match
-- (jags staff already covered by the first clause), so effectively only 'tpi'/'contractor' rows get
-- a second route in.
--
-- `provider` uses the spec's own three labels (Jags/TPI/Contractor, R54) which don't line up
-- one-to-one with project_parties.party_type's finer-grained set — 'tpi' maps to party_type
-- 'tpi_lab', and 'contractor' can be either 'main_contractor' or 'subcontractor' (either is a
-- legitimate "the contractor" for this purpose), hence the explicit mapping below rather than a
-- direct equality.
create policy activity_expected_records_write on public.activity_expected_records
  for all using (
    public.is_jags_staff()
    or exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.project_parties pp on pp.project_id = i.project_id
      where it.id = activity_expected_records.itp_item_id
        and pp.user_id = auth.uid()
        and (
          (activity_expected_records.provider = 'jags' and pp.party_type = 'jags')
          or (activity_expected_records.provider = 'tpi' and pp.party_type = 'tpi_lab')
          or (activity_expected_records.provider = 'contractor' and pp.party_type in ('main_contractor', 'subcontractor'))
        )
    )
  )
  with check (
    public.is_jags_staff()
    or exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.project_parties pp on pp.project_id = i.project_id
      where it.id = activity_expected_records.itp_item_id
        and pp.user_id = auth.uid()
        and (
          (activity_expected_records.provider = 'jags' and pp.party_type = 'jags')
          or (activity_expected_records.provider = 'tpi' and pp.party_type = 'tpi_lab')
          or (activity_expected_records.provider = 'contractor' and pp.party_type in ('main_contractor', 'subcontractor'))
        )
    )
  );

-- Storage: uploaded evidence files reuse the "inspection-evidence" bucket, path
-- expected-records/{project_id}/{itp_item_id}/{filename} — same has_org_access-via-project-join
-- pattern as the vault's own storage policies (20260910010000_phase2_document_vault.sql).
create policy inspection_evidence_expected_records_select on storage.objects
  for select using (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(name))[1] = 'expected-records'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2]
        and public.has_org_access(p.organization_id)
    )
  );

create policy inspection_evidence_expected_records_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-evidence'
    and (storage.foldername(name))[1] = 'expected-records'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(name))[2]
        and public.has_org_access(p.organization_id)
    )
  );
