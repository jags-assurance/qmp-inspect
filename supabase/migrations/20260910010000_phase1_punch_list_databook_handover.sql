-- Phase 1: project-wide punch list, Data Book compilation, and Handover (Reqs R85-R90, R92-R96).
--
-- Punch list: standalone_assignment_punch_items (phase1_standalone_assignments migration) is a
-- per-assignment list scoped to a single FAT/witness/etc. This is a *different*, project-wide
-- register that aggregates outstanding items from every source across a project — inspection
-- failures, FAT conditional-passes, NCRs, and manual walkdown entries — so the project team has one
-- place to see everything that must be closed before handover. It intentionally does not replace or
-- fold in the per-assignment table; the two answer different questions ("what's left on this one
-- FAT" vs "what's left on this project").
--
-- Same reasoning as ncrs_write / standalone_assignments_write: closing out a punch item is
-- routinely the contractor's or subcontractor's own work, not JAGS-staff-only, so RLS here gates on
-- tenant isolation (has_org_access) alone.
create table public.punch_list_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  description text not null,
  source text not null check (source in ('inspection_failure','fat_conditional_pass','ncr','walkdown','manual')),
  source_inspection_record_id uuid references public.inspection_records(id),
  source_standalone_assignment_id uuid references public.standalone_assignments(id),
  source_ncr_id uuid references public.ncrs(id),
  location text,
  responsible_party_id uuid references public.project_parties(id),
  due_date date,
  status text not null default 'open' check (status in ('open','closed')),
  closing_evidence text,
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index punch_list_items_project_id_idx on public.punch_list_items (project_id);
create index punch_list_items_status_idx on public.punch_list_items (status);

alter table public.punch_list_items enable row level security;

create policy punch_list_items_select on public.punch_list_items
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = punch_list_items.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy punch_list_items_write on public.punch_list_items
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = punch_list_items.project_id and public.has_org_access(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = punch_list_items.project_id and public.has_org_access(p.organization_id)
    )
  );

-- Data Book: the compiled quality-record package for a project. Compilation is explicitly blocked
-- (R86) until every required item is verified and the punch list has zero open items, with a
-- documented, logged override path for an authorized (JAGS staff) exception (R87) — that gate is
-- enforced in the app (apps/web/lib/databook/actions.ts), the same "deliberate visible action, not
-- a trigger side effect" approach used for checklist generation and ITP acceptance elsewhere in
-- this schema. Compiling a Data Book is a formal quality-record action, so unlike the punch list
-- above, write access here is staff-only.
create table public.data_books (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  book_number text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','compiled','issued')),
  compiled_by uuid references public.users(id),
  compiled_at timestamptz,
  override_open_punch_items boolean not null default false,
  override_reason text,
  override_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique(project_id, book_number)
);

create index data_books_project_id_idx on public.data_books (project_id);

alter table public.data_books enable row level security;

create policy data_books_select on public.data_books
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = data_books.project_id and public.has_org_access(p.organization_id)
    )
  );

create policy data_books_staff_write on public.data_books
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

-- Handover certificate: issued once a Data Book reaches 'compiled' and is moved to 'issued', making
-- it visible in the client-facing Handover Portal. Issuing is a formal JAGS action (staff-only,
-- mirrors data_books_staff_write), but acknowledging receipt is the client's own action on their own
-- handover package — gating that on is_jags_staff() would lock the client out of confirming their
-- own delivery. Rather than splitting select/insert/update policies (which can't restrict which
-- *columns* an update touches), acknowledgement goes through a narrow SECURITY DEFINER function,
-- the same pattern as accept_itp() in the ITP core migration: it only ever stamps
-- acknowledged_at/received_by_name/received_by_company, and only for someone whose access reaches
-- that certificate's organisation.
create table public.handover_certificates (
  id uuid primary key default gen_random_uuid(),
  data_book_id uuid not null unique references public.data_books(id) on delete cascade,
  certificate_number text not null,
  issued_date date not null default current_date,
  issued_by uuid references public.users(id),
  received_by_name text,
  received_by_company text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.handover_certificates enable row level security;

create policy handover_certificates_select on public.handover_certificates
  for select using (
    exists (
      select 1 from public.data_books db
      join public.projects p on p.id = db.project_id
      where db.id = handover_certificates.data_book_id and public.has_org_access(p.organization_id)
    )
  );

create policy handover_certificates_staff_write on public.handover_certificates
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create or replace function public.acknowledge_handover(
  target_certificate_id uuid,
  received_name text,
  received_company text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cert_org uuid;
begin
  select o.id into cert_org
  from public.handover_certificates hc
  join public.data_books db on db.id = hc.data_book_id
  join public.projects p on p.id = db.project_id
  join public.organizations o on o.id = p.organization_id
  where hc.id = target_certificate_id;

  if cert_org is null then
    raise exception 'Handover certificate not found';
  end if;

  if not public.has_org_access(cert_org) then
    raise exception 'Not authorized for this organisation';
  end if;

  update public.handover_certificates
  set acknowledged_at = now(), received_by_name = received_name, received_by_company = received_company
  where id = target_certificate_id and acknowledged_at is null;

  if not found then
    raise exception 'Certificate not found, or already acknowledged';
  end if;
end;
$$;

grant execute on function public.acknowledge_handover(uuid, text, text) to authenticated;
