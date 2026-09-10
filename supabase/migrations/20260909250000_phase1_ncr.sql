-- Phase 1: Non-Conformance Reports & Observations (Reqs R82-R84).
-- One engine graded by severity (observation / minor NCR / major NCR) rather than three separate
-- tables — the lifecycle is identical across all three (description, requirement not met,
-- assignment + due date, root cause, corrective/preventive action, verification, closure); only
-- the label and how seriously it is tracked differs, and that's a single check-constrained column.
--
-- An NCR is usually raised off a failed inspection, but not always — it can also come from a
-- walkdown or be raised standalone — so both itp_item_id and inspection_record_id are optional
-- links, not a required chain. inspection_records is owned by a different, concurrently-landing
-- migration; we only reference its id column here.
--
-- Unlike ITP authoring (JAGS-staff-only), raising and progressing an NCR is shared work: a JAGS
-- inspector raises it, but assignment and the corrective-action response are often the client's or
-- contractor's own work on their org's project. So RLS here gates on tenant isolation
-- (has_org_access) alone — is_jags_staff() is deliberately not part of the write policy.

create table public.ncrs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  itp_item_id uuid references public.itp_items (id),
  inspection_record_id uuid references public.inspection_records (id),
  -- Generated in the app as "{project_number}-NCR-{seq}", not the DB — same approach as other
  -- human-facing document numbers in this schema (e.g. itp_number).
  ncr_number text not null,
  severity text not null check (severity in ('observation', 'minor_ncr', 'major_ncr')),
  description text not null,
  requirement_not_met text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'pending_verification', 'closed')),
  assigned_to uuid references public.users (id),
  due_date date,
  root_cause text,
  corrective_action text,
  preventive_action text,
  verification_notes text,
  raised_by uuid references public.users (id),
  closed_by uuid references public.users (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, ncr_number)
);

create index ncrs_project_id_idx on public.ncrs (project_id);
create index ncrs_status_idx on public.ncrs (status);

create trigger ncrs_set_updated_at
  before update on public.ncrs
  for each row execute function public.set_updated_at();

alter table public.ncrs enable row level security;

create policy ncrs_select on public.ncrs
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = ncrs.project_id and public.has_org_access(p.organization_id)
    )
  );

-- Deliberately not staff-only (contrast with itps_staff_write / itp_items_staff_write): the
-- boundary that matters for this workflow is tenant isolation, not who inside the tenant is
-- writing. Anyone with org access to the project — JAGS staff or the client/contractor side —
-- can raise an NCR and progress it through to closure.
create policy ncrs_write on public.ncrs
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = ncrs.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = ncrs.project_id and public.has_org_access(p.organization_id)
    )
  );
