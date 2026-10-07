-- Stage 5 (NCR / punch list) schema additions and shared helpers. Additive and idempotent: every
-- new column is nullable (or has a default) so existing rows and the currently deployed app keep
-- working; the app degrades gracefully until this is applied.
--
--   S5-22  NCR data model: location, equipment tag, spec clause, root-cause category (configurable
--          taxonomy table), disposition, cost / schedule impact, contractor response.
--   S5-17  Withdraw (raised in error / duplicate) for NCRs and punch items: kept as status 'closed'
--          plus withdrawn_* columns, so every existing "open item" gate (Data Book, handover,
--          KPIs) already excludes them without code changes.
--   S5-12  ncrs.capa_updated_by (who last wrote root cause / corrective / preventive action),
--          ncrs.close_override_reason.
--   S5-19  ncrs.reopen_count / last_reopen_reason.
--   S5-23  walkdowns header record; ncr_photos captured_at + before/after tag; punch items link to a walkdown.
--   S5-14  punch_list_items.client_request_id (idempotency key for double-submits).
--   helpers used by the guard triggers in the next migrations.

-- ===== 1. NCR columns =====
alter table public.ncrs
  add column if not exists location text,
  add column if not exists equipment_tag text,
  add column if not exists spec_reference text,
  add column if not exists root_cause_category text,
  add column if not exists disposition text,
  add column if not exists cost_impact numeric(14, 2),
  add column if not exists schedule_impact_days integer,
  add column if not exists contractor_response text,
  add column if not exists capa_updated_by uuid references public.users (id) on delete set null,
  add column if not exists close_override_reason text,
  add column if not exists reopen_count integer not null default 0,
  add column if not exists last_reopen_reason text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references public.users (id) on delete set null,
  add column if not exists withdrawn_reason text,
  add column if not exists duplicate_of_ncr_id uuid references public.ncrs (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ncrs_disposition_check') then
    alter table public.ncrs add constraint ncrs_disposition_check
      check (disposition is null or disposition in ('rework', 'repair', 'use_as_is', 'reject', 'concession'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ncrs_schedule_impact_check') then
    alter table public.ncrs add constraint ncrs_schedule_impact_check
      check (schedule_impact_days is null or schedule_impact_days between 0 and 3650);
  end if;
end $$;

create index if not exists ncrs_equipment_tag_idx on public.ncrs (project_id, equipment_tag) where equipment_tag is not null;

-- ===== 2. NCR photos: capture time + before/after tag =====
alter table public.ncr_photos
  add column if not exists captured_at timestamptz,
  add column if not exists photo_tag text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ncr_photos_photo_tag_check') then
    alter table public.ncr_photos add constraint ncr_photos_photo_tag_check
      check (photo_tag is null or photo_tag in ('before', 'after', 'evidence'));
  end if;
end $$;

-- ===== 3. Configurable root-cause taxonomy =====
-- organization_id null = platform defaults (seeded below); an org-specific row adds to / overrides them.
create table if not exists public.ncr_root_cause_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 2 and 80),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists ncr_root_cause_categories_code_uidx
  on public.ncr_root_cause_categories (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

alter table public.ncr_root_cause_categories enable row level security;

drop policy if exists ncr_root_cause_categories_select on public.ncr_root_cause_categories;
create policy ncr_root_cause_categories_select on public.ncr_root_cause_categories for select to authenticated using (
  organization_id is null or public.has_org_access(organization_id)
);
drop policy if exists ncr_root_cause_categories_write on public.ncr_root_cause_categories;
create policy ncr_root_cause_categories_write on public.ncr_root_cause_categories for all to authenticated
  using (organization_id is not null and public.is_admin_staff() and public.has_org_access(organization_id))
  with check (organization_id is not null and public.is_admin_staff() and public.has_org_access(organization_id));

insert into public.ncr_root_cause_categories (organization_id, code, label, sort_order) values
  (null, 'workmanship', 'Workmanship / skill', 10),
  (null, 'material', 'Material / product defect', 20),
  (null, 'design', 'Design / drawing error', 30),
  (null, 'method', 'Method / procedure not followed', 40),
  (null, 'equipment', 'Equipment / tooling', 50),
  (null, 'training', 'Training / competence', 60),
  (null, 'supervision', 'Supervision / inspection gap', 70),
  (null, 'documentation', 'Documentation / communication', 80),
  (null, 'environment', 'Site conditions / environment', 90),
  (null, 'other', 'Other', 999)
on conflict do nothing;

-- ===== 4. Walkdowns (header record for a punch walkdown) =====
create table if not exists public.walkdowns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  walkdown_number text,
  walked_on date not null default current_date,
  area text,
  attendees text,
  notes text,
  item_count integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  signed_off_by uuid references public.users (id) on delete set null,
  signed_off_at timestamptz
);
create index if not exists walkdowns_project_idx on public.walkdowns (project_id, walked_on desc);

alter table public.walkdowns enable row level security;
drop policy if exists walkdowns_select on public.walkdowns;
create policy walkdowns_select on public.walkdowns for select to authenticated using (
  exists (select 1 from public.projects p where p.id = walkdowns.project_id and public.has_project_access(p.id, p.organization_id))
);
drop policy if exists walkdowns_insert on public.walkdowns;
create policy walkdowns_insert on public.walkdowns for insert to authenticated with check (
  exists (select 1 from public.projects p where p.id = walkdowns.project_id and public.has_project_access(p.id, p.organization_id))
);
drop policy if exists walkdowns_update on public.walkdowns;
create policy walkdowns_update on public.walkdowns for update to authenticated
  using (
    exists (select 1 from public.projects p where p.id = walkdowns.project_id and public.has_project_access(p.id, p.organization_id))
    and (created_by = auth.uid() or public.is_admin_staff())
  )
  with check (
    exists (select 1 from public.projects p where p.id = walkdowns.project_id and public.has_project_access(p.id, p.organization_id))
    and (created_by = auth.uid() or public.is_admin_staff())
  );

-- ===== 5. Punch list columns =====
alter table public.punch_list_items
  add column if not exists walkdown_id uuid references public.walkdowns (id) on delete set null,
  add column if not exists client_request_id text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references public.users (id) on delete set null,
  add column if not exists withdrawn_reason text;

create unique index if not exists punch_list_items_request_uidx
  on public.punch_list_items (project_id, client_request_id)
  where client_request_id is not null;
create index if not exists punch_list_items_walkdown_idx on public.punch_list_items (walkdown_id) where walkdown_id is not null;
create index if not exists punch_list_items_source_ncr_idx on public.punch_list_items (source_ncr_id) where source_ncr_id is not null;
create index if not exists punch_list_items_source_record_idx on public.punch_list_items (source_inspection_record_id) where source_inspection_record_id is not null;

-- ===== 6. Helpers =====

-- The login linked to a project party (primary contact) or one of its team members.
create or replace function public.is_party_user(target_party_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_party_id is not null and (
    exists (select 1 from public.project_parties pp where pp.id = target_party_id and pp.user_id = auth.uid())
    or exists (select 1 from public.project_party_members m where m.project_party_id = target_party_id and m.user_id = auth.uid())
  );
$$;
revoke all on function public.is_party_user(uuid) from public, anon;
grant execute on function public.is_party_user(uuid) to authenticated, service_role;

-- Close / re-open / withdraw authority on an NCR: admin staff or a close_ncr permission holder.
-- Mirrors mayCloseNcr in apps/web/lib/ncrs/actions.ts.
create or replace function public.can_close_ncr(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin_staff() or public.has_custom_permission(auth.uid(), 'close_ncr', target_project_id);
$$;
revoke all on function public.can_close_ncr(uuid) from public, anon;
grant execute on function public.can_close_ncr(uuid) to authenticated, service_role;

-- May the caller work this NCR (CAPA text, evidence, quick status moves)? Mirrors canWorkNcr in
-- apps/web/lib/ncrs/rules.ts, extended to the responsible party's team members.
create or replace function public.can_work_ncr(target_ncr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_jags_staff()
    or exists (
      select 1 from public.ncrs n
      where n.id = target_ncr_id
        and (n.raised_by = auth.uid() or n.assigned_to = auth.uid() or public.is_party_user(n.responsible_party_id))
    );
$$;
revoke all on function public.can_work_ncr(uuid) from public, anon;
grant execute on function public.can_work_ncr(uuid) to authenticated, service_role;

-- Same-project validation for the links an NCR / punch item may carry.
create or replace function public.itp_item_project_id(target_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.project_id
  from public.itp_items it
  join public.itp_sections s on s.id = it.section_id
  join public.itps i on i.id = s.itp_id
  where it.id = target_item_id;
$$;
revoke all on function public.itp_item_project_id(uuid) from public, anon;
grant execute on function public.itp_item_project_id(uuid) to authenticated, service_role;
