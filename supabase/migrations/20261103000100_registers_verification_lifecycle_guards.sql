-- Stage 3 (pre-work clearances / registers) hardening. Idempotent.
--
-- S3-01  Contractor/sub/TPI-added rows are no longer trusted instantly: every register row carries
--        verified_by / verified_at. Rows inserted by non-staff are UNVERIFIED until JAGS staff verify
--        them; verification, readiness and the soft-stop ignore unverified rows. Existing rows are
--        grandfathered as verified (backfilled once, when the column is first added).
-- S3-03  Recalibration creates a NEW calibration row (supersedes_id) instead of overwriting the old one;
--        the as-found result of the superseded cycle is stored on it.
-- S3-04  Rows can be marked superseded / retired / withdrawn (with a reason) instead of being deleted;
--        readiness excludes them. A used row can no longer be deleted at the database level either.
-- S3-05  checklist_responses keeps the register override reason and the register check result as
--        structured columns (previously smuggled into the comment text).
-- S3-06  itp_items.required_registers: explicit per-activity register requirement.
-- S3-07  projects.timezone so "due today" is judged in the site's calendar day.
-- S3-09  personnel_certifications.holder_user_id: a certificate can belong to a specific person.
-- S3-10  Partial unique indexes stop duplicate active register rows (created only if existing data allows).
-- S3-13  Register tables and ITP content tables refuse writes on completed/cancelled projects.

-- ===== 1. Verification + lifecycle columns (all four registers) =====
do $$
declare
  t text;
  fresh boolean;
begin
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register', 'personnel_certifications'] loop
    select not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'verified_at'
    ) into fresh;

    execute format('alter table public.%I
      add column if not exists verified_by uuid,
      add column if not exists verified_at timestamptz,
      add column if not exists lifecycle_status text not null default ''active'',
      add column if not exists lifecycle_reason text,
      add column if not exists lifecycle_changed_by uuid,
      add column if not exists lifecycle_changed_at timestamptz,
      add column if not exists supersedes_id uuid', t);

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_lifecycle_status_check');
    execute format('alter table public.%I add constraint %I check (lifecycle_status in (''active'', ''superseded'', ''retired'', ''withdrawn''))',
      t, t || '_lifecycle_status_check');

    -- Rows that already exist were all trusted before this migration; keep them that way (once only).
    if fresh then
      execute format('update public.%I set verified_at = created_at where verified_at is null', t);
    end if;
  end loop;
end $$;

alter table public.calibration_register
  add column if not exists as_found_result text,
  add column if not exists as_found_notes text,
  add column if not exists as_found_recorded_at timestamptz;
alter table public.calibration_register drop constraint if exists calibration_register_as_found_check;
alter table public.calibration_register
  add constraint calibration_register_as_found_check
  check (as_found_result is null or as_found_result in ('in_tolerance', 'out_of_tolerance', 'not_recorded'));

alter table public.personnel_certifications
  add column if not exists holder_user_id uuid references public.users (id) on delete set null;

-- Self-reference for recalibration chains (added separately so the loop above stays generic).
do $$
declare
  t text;
begin
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register', 'personnel_certifications'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_supersedes_fk') then
      execute format('alter table public.%I add constraint %I foreign key (supersedes_id) references public.%I (id) on delete set null',
        t, t || '_supersedes_fk', t);
    end if;
  end loop;
end $$;

-- ===== 2. Who may set verification / lifecycle =====
create or replace function public.register_guard_verification()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_jags_staff() then
      -- Anything a contractor / subcontractor / TPI types in starts unverified and active.
      new.verified_by := null;
      new.verified_at := null;
      new.lifecycle_status := 'active';
      new.lifecycle_reason := null;
      new.lifecycle_changed_by := null;
      new.lifecycle_changed_at := null;
    elsif new.verified_at is null then
      new.verified_by := coalesce(new.verified_by, auth.uid());
      new.verified_at := now();
    end if;
  elsif auth.uid() is not null and not public.is_jags_staff() then
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.lifecycle_status is distinct from old.lifecycle_status
       or new.supersedes_id is distinct from old.supersedes_id then
      raise exception 'Only JAGS staff can verify or retire register entries' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.register_guard_verification() from public, anon;

do $$
declare
  t text;
begin
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register', 'personnel_certifications'] loop
    execute format('drop trigger if exists register_guard_verification on public.%I', t);
    execute format('create trigger register_guard_verification before insert or update on public.%I for each row execute function public.register_guard_verification()', t);
  end loop;
end $$;

-- A register row that inspection answers point at is evidence: it is retired, never deleted (the foreign
-- key would otherwise silently null the traceability link on every one of those answers).
create or replace function public.register_guard_delete_used()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_col text;
  v_used bigint;
begin
  if public.is_system_caller() then
    return old;
  end if;
  v_col := case tg_table_name
    when 'calibration_register' then 'calibration_asset_id'
    when 'material_register' then 'material_id'
    when 'welder_qualification_register' then 'welder_id'
    else null end;
  if v_col is null then
    return old;
  end if;
  execute format('select count(*) from public.checklist_responses where %I = $1', v_col) into v_used using old.id;
  if v_used > 0 then
    raise exception 'This register entry is referenced by % inspection answer(s); retire or supersede it instead of deleting it', v_used
      using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.register_guard_delete_used() from public, anon;

do $$
declare
  t text;
begin
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register'] loop
    execute format('drop trigger if exists register_guard_delete_used on public.%I', t);
    execute format('create trigger register_guard_delete_used before delete on public.%I for each row execute function public.register_guard_delete_used()', t);
  end loop;
end $$;

-- ===== 3. Duplicate prevention (S3-10): only among ACTIVE rows, and only if existing data allows =====
do $$
begin
  begin
    create unique index if not exists calibration_register_active_unique
      on public.calibration_register (project_id, lower(cert_number), lower(instrument_name)) where lifecycle_status = 'active';
  exception when unique_violation then
    raise notice 'calibration_register_active_unique skipped: duplicate active rows exist (clean up, then re-run)';
  end;
  begin
    create unique index if not exists welder_register_active_unique
      on public.welder_qualification_register (project_id, lower(welder_identifier), lower(qualified_wps)) where lifecycle_status = 'active';
  exception when unique_violation then
    raise notice 'welder_register_active_unique skipped: duplicate active rows exist (clean up, then re-run)';
  end;
  begin
    create unique index if not exists material_register_active_unique
      on public.material_register (project_id, lower(heat_number), lower(material_description))
      where lifecycle_status = 'active' and heat_number is not null and heat_number <> '';
  exception when unique_violation then
    raise notice 'material_register_active_unique skipped: duplicate active rows exist (clean up, then re-run)';
  end;
  begin
    create unique index if not exists personnel_cert_active_unique
      on public.personnel_certifications (project_id, project_party_id, lower(certification_type), lower(cert_number))
      where lifecycle_status = 'active' and cert_number is not null and cert_number <> '';
  exception when unique_violation then
    raise notice 'personnel_cert_active_unique skipped: duplicate active rows exist (clean up, then re-run)';
  end;
end $$;

-- ===== 4. Checklist responses: structured soft-stop record (S3-05) =====
alter table public.checklist_responses
  add column if not exists override_reason text,
  add column if not exists register_check_result jsonb,
  add column if not exists captured_at timestamptz;

-- ===== 5. ITP activity: explicit register requirement (S3-06) =====
alter table public.itp_items add column if not exists required_registers text[];
alter table public.itp_items drop constraint if exists itp_items_required_registers_check;
alter table public.itp_items
  add constraint itp_items_required_registers_check
  check (required_registers is null or required_registers <@ array['calibration', 'welder', 'material', 'personnel']::text[]);

-- ===== 6. Project timezone (S3-07) =====
alter table public.projects add column if not exists timezone text;

-- ===== 7. Storage: project-scoped delete + restricted registers/ uploads (S3-02) =====
-- Same two branches as the previous insert policy (project folder / standalone assignment folder), but
-- project access is now PROJECT-scoped (has_project_access) instead of "any grant in the org", and the
-- <project>/registers/ folder only accepts uploads from JAGS staff or the project's register contributors,
-- limited to document / image file types. (A bucket-level file_size_limit is a dashboard setting; see docs.)
drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and public.has_project_access(p.id, p.organization_id)
        and (
          (storage.foldername(objects.name))[2] is distinct from 'registers'
          or (
            (public.is_jags_staff() or public.is_register_contributor(p.id))
            and lower(objects.name) ~ '\.(pdf|png|jpe?g|webp|heic|docx?|xlsx?)$'
          )
        )
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and public.has_project_access(p.id, p.organization_id)
        and public.can_run_standalone_assignment(a.project_id)
    )
  )
);

drop policy if exists inspection_evidence_delete on storage.objects;
create policy inspection_evidence_delete on storage.objects for delete using (
  bucket_id = 'inspection-evidence'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(objects.name))[1]
      and public.has_project_access(p.id, p.organization_id)
      and (
        (storage.foldername(objects.name))[2] is distinct from 'registers'
        or public.is_jags_staff()
        or objects.owner_id = auth.uid()::text
      )
  )
);

-- ===== 8. Closed-project write guard for registers and ITP content (S3-13) =====
create or replace function public.register_itp_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_pid uuid;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() or public.is_admin_staff() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name in ('calibration_register', 'welder_qualification_register', 'material_register', 'personnel_certifications', 'itps') then
    v_pid := nullif(v_row->>'project_id', '')::uuid;
  elsif tg_table_name = 'itp_sections' then
    select i.project_id into v_pid from public.itps i where i.id = nullif(v_row->>'itp_id', '')::uuid;
  elsif tg_table_name = 'itp_items' then
    select i.project_id into v_pid
    from public.itp_sections s join public.itps i on i.id = s.itp_id
    where s.id = nullif(v_row->>'section_id', '')::uuid;
  end if;

  if v_pid is not null and not public.project_is_writable(v_pid) then
    raise exception 'This project is completed or cancelled; changes are not allowed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.register_itp_write_guard() from public, anon, authenticated;

do $$
declare
  t text;
begin
  if to_regprocedure('public.project_is_writable(uuid)') is null then
    raise notice 'project_is_writable missing; skipping register/ITP closed-project guards';
    return;
  end if;
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register', 'personnel_certifications',
                           'itps', 'itp_sections', 'itp_items'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists register_itp_write_guard on public.%I', t);
      execute format('create trigger register_itp_write_guard before insert or update or delete on public.%I for each row execute function public.register_itp_write_guard()', t);
    end if;
  end loop;
end $$;
