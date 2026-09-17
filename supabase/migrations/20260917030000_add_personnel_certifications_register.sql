-- Personnel certification register (Round-table finding): the app already tracks calibration,
-- welder-qualification, and material registers (Reqs R92-R100) but has no register for whether the
-- PERSON performing/signing off an inspection actually holds a current, valid
-- qualification/certification for that activity type (e.g. AWS CWI, ASNT NDT Level II/III,
-- CSWIP 3.1). certification_type is deliberately free text, not an enum, since real-world cert
-- schemes vary too widely to enumerate.
--
-- Tied to project_parties (the person/role actually performing work), not a raw user id, matching
-- how this app already models "who is doing the work" elsewhere (activity_party_intervention,
-- activity_signoff_progress).
--
-- Same "status is a stored column, recomputed at read time from today's date" pattern as the other
-- three registers -- see apps/web/lib/registers/refresh.ts, extended here rather than driven by a
-- trigger or scheduled job.
--
-- RLS follows the CURRENT live pattern (has_project_access, confirmed via a live pg_policies query
-- in this session), not the has_org_access text that 20260910050000_phase3_registers.sql originally
-- shipped with and 20260916000000_fix_remaining_project_scoped_grants_and_ncr_photos.sql later
-- corrected on disk/live.

create table public.personnel_certifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  project_party_id uuid not null references public.project_parties (id) on delete cascade,
  certification_type text not null,
  cert_number text,
  issued_date date,
  expiry_date date not null,
  status text not null default 'valid' check (status in ('valid', 'expiring_soon', 'expired')),
  notes text,
  created_at timestamptz not null default now()
);

create index personnel_certifications_project_id_idx on public.personnel_certifications (project_id);
create index personnel_certifications_project_party_id_idx on public.personnel_certifications (project_party_id);

alter table public.personnel_certifications enable row level security;

create policy personnel_certifications_select on public.personnel_certifications for select using (
  exists (
    select 1 from public.projects p
    where p.id = personnel_certifications.project_id and public.has_project_access(p.id, p.organization_id)
  )
);

create policy personnel_certifications_write on public.personnel_certifications for all using (
  exists (
    select 1 from public.projects p
    where p.id = personnel_certifications.project_id and public.has_project_access(p.id, p.organization_id)
  )
) with check (
  exists (
    select 1 from public.projects p
    where p.id = personnel_certifications.project_id and public.has_project_access(p.id, p.organization_id)
  )
);
