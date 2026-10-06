-- Stage 3 (pre-work clearances) hardening: registers.
--
-- 1. WHO can write: previously ANY project access grant could insert/update/delete rows in the material,
--    welder, calibration and personnel registers (so a client could mark a material "released" or delete an
--    expired calibration to clear a Data Book blocker). Now: JAGS staff (with project access) can do
--    everything; the project's own contractor / subcontractor / TPI-lab parties can ADD entries; nobody
--    else can write. A contractor-added material always lands as "received — pending inspection" and only
--    JAGS staff can release it.
-- 2. Material receiving: new receipt status + who released it and when.
-- 3. Traceability: a checklist response can record WHICH material and WHICH welder it was checked against.
-- 4. Certificate attachment path on every register row.
-- 5. Sensible date ordering (new rows only; existing rows are not re-validated).

create or replace function public.is_register_contributor(target_project_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.project_parties pp
    where pp.project_id = target_project_id
      and pp.user_id = auth.uid()
      and pp.is_active
      and pp.party_type in ('main_contractor', 'subcontractor', 'tpi_lab')
  );
$$;

do $$
declare
  t text;
begin
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register', 'personnel_certifications'] loop
    execute format('drop policy if exists %I on public.%I', t || '_write_i', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_u', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_d', t);
    execute format($p$
      create policy %I on public.%I for insert with check (
        exists (select 1 from public.projects p where p.id = %I.project_id and public.has_project_access(p.id, p.organization_id)
                and (public.is_jags_staff() or public.is_register_contributor(p.id))))$p$, t || '_write_i', t, t);
    execute format($p$
      create policy %I on public.%I for update
        using (exists (select 1 from public.projects p where p.id = %I.project_id and public.is_jags_staff() and public.has_project_access(p.id, p.organization_id)))
        with check (exists (select 1 from public.projects p where p.id = %I.project_id and public.is_jags_staff() and public.has_project_access(p.id, p.organization_id)))$p$,
      t || '_write_u', t, t, t);
    execute format($p$
      create policy %I on public.%I for delete
        using (exists (select 1 from public.projects p where p.id = %I.project_id and public.is_jags_staff() and public.has_project_access(p.id, p.organization_id)))$p$,
      t || '_write_d', t, t);
  end loop;
end $$;

-- Material receiving.
alter table public.material_register drop constraint if exists material_register_receipt_status_check;
alter table public.material_register
  add constraint material_register_receipt_status_check
  check (receipt_status in ('released', 'quarantined_pending_disposition', 'on_hold', 'received_pending_inspection'));
alter table public.material_register
  add column if not exists released_by uuid,
  add column if not exists released_at timestamptz,
  add column if not exists supplier text,
  add column if not exists quantity text;

-- A non-staff submitter can never create (or change) a material as released.
create or replace function public.material_register_guard_release()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_jags_staff() then
    if tg_op = 'INSERT' then
      new.receipt_status := 'received_pending_inspection';
      new.released_by := null;
      new.released_at := null;
    elsif new.receipt_status is distinct from old.receipt_status then
      raise exception 'Only JAGS staff can change a material''s receipt status' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.receipt_status = 'released' and old.receipt_status is distinct from 'released' then
    new.released_by := coalesce(new.released_by, auth.uid());
    new.released_at := coalesce(new.released_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists material_register_guard_release on public.material_register;
create trigger material_register_guard_release before insert or update on public.material_register
  for each row execute function public.material_register_guard_release();

-- Certificate files (stored in the inspection-evidence bucket under registers/<project>/...).
alter table public.material_register add column if not exists certificate_path text;
alter table public.calibration_register
  add column if not exists certificate_path text,
  add column if not exists instrument_tag text,
  add column if not exists calibration_lab text;
alter table public.welder_qualification_register
  add column if not exists certificate_path text,
  add column if not exists wpq_number text,
  add column if not exists process text,
  add column if not exists position text;
alter table public.personnel_certifications add column if not exists certificate_path text;

-- Traceability: which material / welder a checklist answer was verified against.
alter table public.checklist_responses
  add column if not exists material_id uuid references public.material_register (id) on delete set null,
  add column if not exists welder_id uuid references public.welder_qualification_register (id) on delete set null;
create index if not exists checklist_responses_material_idx on public.checklist_responses (material_id) where material_id is not null;
create index if not exists checklist_responses_welder_idx on public.checklist_responses (welder_id) where welder_id is not null;

-- Date ordering on new rows.
alter table public.calibration_register drop constraint if exists calibration_register_dates_check;
alter table public.calibration_register
  add constraint calibration_register_dates_check check (cal_date is null or due_date >= cal_date) not valid;
alter table public.personnel_certifications drop constraint if exists personnel_certifications_dates_check;
alter table public.personnel_certifications
  add constraint personnel_certifications_dates_check check (issued_date is null or expiry_date >= issued_date) not valid;
