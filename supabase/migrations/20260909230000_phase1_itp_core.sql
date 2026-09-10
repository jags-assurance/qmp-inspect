-- Phase 1: ITP core — sections, activities, and the per-party H/W/R/S intervention grid.
-- This is the centerpiece of QMP Inspect: an ITP is prepared, reviewed, approved by JAGS, then
-- accepted by the client before it has any authority (Reqs R66-R81). Sections are not fixed
-- (R24) — the four defaults created on ITP creation are a starting point the user can add to,
-- rename, or reorder, not a hardcoded structure.

create table public.itps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  itp_number text not null,
  title text not null,
  scope text,
  applicable_standard text,
  revision int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'under_review', 'approved', 'client_accepted')),
  prepared_by uuid references public.users (id),
  reviewed_by uuid references public.users (id),
  approved_by uuid references public.users (id),
  client_accepted_by uuid references public.users (id),
  client_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, itp_number)
);

create index itps_project_id_idx on public.itps (project_id);

create trigger itps_set_updated_at
  before update on public.itps
  for each row execute function public.set_updated_at();

create table public.itp_sections (
  id uuid primary key default gen_random_uuid(),
  itp_id uuid not null references public.itps (id) on delete cascade,
  section_number int not null,
  title text not null,
  sort_order int not null default 0,
  unique (itp_id, section_number)
);

create table public.itp_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.itp_sections (id) on delete cascade,
  item_number text not null,
  activity text not null,
  reference_spec text,
  acceptance_criteria text,
  method text,
  frequency text,
  -- 1 = checklist, 2 = document upload, 3 = measurement record (Reqs ITP Phase 2 evidence types).
  evidence_type int not null default 1 check (evidence_type in (1, 2, 3)),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index itp_items_section_id_idx on public.itp_items (section_id);

-- The per-party intervention grid: one row per (item, party) that actually has a level set.
-- No row = that party has no intervention on that activity, which is the common case, so this is
-- sparse by design rather than one column per party baked into itp_items.
create table public.activity_party_intervention (
  id uuid primary key default gen_random_uuid(),
  itp_item_id uuid not null references public.itp_items (id) on delete cascade,
  project_party_id uuid not null references public.project_parties (id) on delete cascade,
  intervention text not null check (intervention in ('H', 'W', 'R', 'S')),
  unique (itp_item_id, project_party_id)
);

create index activity_party_intervention_item_idx on public.activity_party_intervention (itp_item_id);

alter table public.itps enable row level security;
alter table public.itp_sections enable row level security;
alter table public.itp_items enable row level security;
alter table public.activity_party_intervention enable row level security;

create policy itps_select on public.itps
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = itps.project_id and public.has_org_access(p.organization_id)
    )
  );

-- Preparing/reviewing/approving an ITP is JAGS work (Reqs §2). Client acceptance is a distinct,
-- narrower transition handled by accept_itp() below, not a general write grant.
create policy itps_staff_write on public.itps
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy itp_sections_select on public.itp_sections
  for select using (
    exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = itp_sections.itp_id and public.has_org_access(p.organization_id)
    )
  );

create policy itp_sections_staff_write on public.itp_sections
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy itp_items_select on public.itp_items
  for select using (
    exists (
      select 1 from public.itp_sections s
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where s.id = itp_items.section_id and public.has_org_access(p.organization_id)
    )
  );

create policy itp_items_staff_write on public.itp_items
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy activity_party_intervention_select on public.activity_party_intervention
  for select using (
    exists (
      select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_party_intervention.itp_item_id
        and public.has_org_access(p.organization_id)
    )
  );

create policy activity_party_intervention_staff_write on public.activity_party_intervention
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

-- Client acceptance: a narrow, auditable state transition rather than a general UPDATE grant.
-- Only moves approved -> client_accepted, only for someone whose access reaches that ITP's
-- organisation, and only stamps their own user id — nothing else about the row can be touched
-- through this path.
create or replace function public.accept_itp(target_itp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  itp_org uuid;
begin
  select o.id into itp_org
  from public.itps i
  join public.projects p on p.id = i.project_id
  join public.organizations o on o.id = p.organization_id
  where i.id = target_itp_id;

  if itp_org is null then
    raise exception 'ITP not found';
  end if;

  if not public.has_org_access(itp_org) then
    raise exception 'Not authorized for this organisation';
  end if;

  update public.itps
  set status = 'client_accepted', client_accepted_by = auth.uid(), client_accepted_at = now()
  where id = target_itp_id and status = 'approved';

  if not found then
    raise exception 'ITP must be approved before it can be accepted';
  end if;
end;
$$;

grant execute on function public.accept_itp(uuid) to authenticated;
