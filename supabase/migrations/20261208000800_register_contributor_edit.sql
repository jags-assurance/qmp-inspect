-- Register contributors (contractor / subcontractor / TPI parties) can correct and renew THEIR OWN entries
-- until JAGS staff verify them (audit M8): calibration, welder, material and personnel registers.
-- * created_by records who added a row (set by the database from auth.uid(); non-staff cannot change it).
--   Existing rows have created_by NULL, so they stay staff-only.
-- * a new permissive UPDATE policy lets a contributor update a row only when created_by = them, the row is
--   not verified (verified_at is null) and the result is still unverified. Verified rows, other people's rows,
--   delete and lifecycle/verification changes stay staff-only (register_guard_verification still blocks them).
-- * register_certificate_history may be written by the contributor who owns the (unverified) entry.
-- Idempotent. ROLLBACK:
--   drop policy if exists calibration_register_contributor_u on public.calibration_register;  (and the same for
--   welder_qualification_register_contributor_u, material_register_contributor_u, personnel_certifications_contributor_u)
--   restore register_guard_verification from 20261103000100 (without the created_by lines), restore the
--   register_certificate_history_insert policy to staff-only, then optionally drop the created_by columns.

alter table public.calibration_register add column if not exists created_by uuid references public.users (id) on delete set null;
alter table public.welder_qualification_register add column if not exists created_by uuid references public.users (id) on delete set null;
alter table public.material_register add column if not exists created_by uuid references public.users (id) on delete set null;
alter table public.personnel_certifications add column if not exists created_by uuid references public.users (id) on delete set null;

create index if not exists calibration_register_created_by_idx on public.calibration_register (created_by);
create index if not exists welder_qualification_register_created_by_idx on public.welder_qualification_register (created_by);
create index if not exists material_register_created_by_idx on public.material_register (created_by);
create index if not exists personnel_certifications_created_by_idx on public.personnel_certifications (created_by);

create or replace function public.register_guard_verification()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();   -- ownership is always the caller, never client supplied
    end if;
    if auth.uid() is not null and not public.is_jags_staff() then
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
    if new.created_by is distinct from old.created_by then
      raise exception 'The owner of a register entry cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

drop policy if exists calibration_register_contributor_u on public.calibration_register;
create policy calibration_register_contributor_u on public.calibration_register for update
  using (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = calibration_register.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)))
  with check (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = calibration_register.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)));

drop policy if exists welder_qualification_register_contributor_u on public.welder_qualification_register;
create policy welder_qualification_register_contributor_u on public.welder_qualification_register for update
  using (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = welder_qualification_register.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)))
  with check (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = welder_qualification_register.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)));

drop policy if exists material_register_contributor_u on public.material_register;
create policy material_register_contributor_u on public.material_register for update
  using (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = material_register.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)))
  with check (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = material_register.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)));

drop policy if exists personnel_certifications_contributor_u on public.personnel_certifications;
create policy personnel_certifications_contributor_u on public.personnel_certifications for update
  using (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = personnel_certifications.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)))
  with check (created_by = (select auth.uid()) and verified_at is null and exists (
    select 1 from public.projects p where p.id = personnel_certifications.project_id
      and public.has_project_access(p.id, p.organization_id) and public.is_register_contributor(p.id)));

-- Certificate replacement history: staff, or the contributor who owns the unverified entry.
drop policy if exists register_certificate_history_insert on public.register_certificate_history;
create policy register_certificate_history_insert on public.register_certificate_history for insert
  with check (
    replaced_by = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = register_certificate_history.project_id and public.has_project_access(p.id, p.organization_id))
    and (
      public.is_jags_staff()
      or (
        public.is_register_contributor(register_certificate_history.project_id)
        and case register_certificate_history.register_kind
          when 'calibration' then exists (select 1 from public.calibration_register r where r.id = register_certificate_history.entry_id and r.created_by = (select auth.uid()) and r.verified_at is null)
          when 'welder' then exists (select 1 from public.welder_qualification_register r where r.id = register_certificate_history.entry_id and r.created_by = (select auth.uid()) and r.verified_at is null)
          when 'material' then exists (select 1 from public.material_register r where r.id = register_certificate_history.entry_id and r.created_by = (select auth.uid()) and r.verified_at is null)
          when 'personnel' then exists (select 1 from public.personnel_certifications r where r.id = register_certificate_history.entry_id and r.created_by = (select auth.uid()) and r.verified_at is null)
          else false
        end
      )
    )
  );
