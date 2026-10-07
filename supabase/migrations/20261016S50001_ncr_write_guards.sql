-- Stage 5: NCR write guards at the database layer. Mirrors lib/ncrs/actions.ts so a crafted client
-- request cannot skip workflow states, forge raised_by/closed_by, grade severity, reassign an NCR
-- it did not raise, delete a closed NCR or change evidence on a closed NCR.
-- Exemptions: public.is_system_caller() (worker service_role, migrations) and pg_trigger_depth() > 1
-- (cascades from other triggers / FK actions). Idempotent. Depends on 20261015S40001 (is_system_caller).

-- ===== 1. Workflow trigger (existing rules kept verbatim, new rules added) =====
create or replace function public.ncrs_enforce_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
begin
  if tg_op = 'UPDATE' then
    -- ---- existing rules (20261013N10001) ----
    -- A closed NCR is immutable except for a re-open by JAGS staff.
    if old.status = 'closed' and new.status <> 'open' and new.status <> 'in_progress' then
      raise exception 'Closed NCR cannot be modified';
    end if;
    if old.status = 'closed' and new.status in ('open', 'in_progress') and not public.is_jags_staff() then
      raise exception 'Only JAGS staff can re-open an NCR';
    end if;

    if new.status = 'closed' and old.status <> 'closed' then
      if not public.is_jags_staff() then
        raise exception 'Only JAGS staff can close an NCR';
      end if;
      if old.status <> 'pending_verification' then
        raise exception 'NCR must be pending verification before closing';
      end if;
      if coalesce(btrim(new.root_cause), '') = '' or coalesce(btrim(new.corrective_action), '') = ''
         or coalesce(btrim(new.preventive_action), '') = '' or coalesce(btrim(new.verification_notes), '') = '' then
        raise exception 'Root cause, corrective action, preventive action and verification notes are required to close';
      end if;
      if old.raised_by is not null and old.raised_by = auth.uid() and not public.is_admin_staff() then
        raise exception 'The person who raised an NCR cannot close it';
      end if;
      if not exists (select 1 from public.ncr_photos where ncr_id = new.id)
         and not exists (select 1 from public.ncr_documents where ncr_id = new.id) then
        raise exception 'At least one evidence photo or linked document is required to close';
      end if;
    end if;

    -- ---- Stage 5 rules ----
    if public.is_system_caller() or pg_trigger_depth() > 1 then
      if new.status = 'closed' and old.status <> 'closed' then
        new.closed_at := coalesce(new.closed_at, now());
      end if;
      return new;
    end if;

    v_staff := public.is_jags_staff();

    -- Identity columns never change.
    if new.raised_by is distinct from old.raised_by then
      raise exception 'raised_by cannot be changed';
    end if;
    if new.ncr_number is distinct from old.ncr_number then
      raise exception 'ncr_number cannot be changed';
    end if;
    if new.project_id is distinct from old.project_id then
      raise exception 'project_id cannot be changed';
    end if;

    -- Status machine: open -> in_progress -> pending_verification -> closed.
    if new.status is distinct from old.status then
      if old.status <> 'closed' then
        if not ((old.status = 'open' and new.status = 'in_progress')
             or (old.status = 'in_progress' and new.status = 'pending_verification')
             or (old.status = 'pending_verification' and new.status = 'closed')
             or (old.status = 'pending_verification' and new.status = 'in_progress')) then
          raise exception 'Invalid NCR status change from % to %', old.status, new.status;
        end if;
        if old.status = 'pending_verification' and new.status = 'in_progress' and not v_staff then
          raise exception 'Only JAGS staff can return an NCR from verification';
        end if;
        if new.status in ('in_progress', 'pending_verification') and old.status in ('open', 'in_progress')
           and not v_staff
           and old.raised_by is distinct from v_uid and old.assigned_to is distinct from v_uid then
          raise exception 'Only the raiser, the assignee or JAGS staff can update this NCR';
        end if;
      end if;

      if new.status = 'pending_verification' then
        if coalesce(btrim(new.corrective_action), '') = '' or coalesce(btrim(new.preventive_action), '') = '' then
          raise exception 'Corrective and preventive action are required before sending for verification';
        end if;
      end if;

      if new.status = 'closed' then
        new.closed_by := v_uid;
        new.closed_at := now();
      elsif old.status = 'closed' then
        new.closed_by := null;
        new.closed_at := null;
      end if;
    else
      -- No status change: closure stamps cannot be edited.
      new.closed_by := old.closed_by;
      new.closed_at := old.closed_at;
    end if;

    -- Severity changes (observation -> NCR grade-up) are staff-only.
    if new.severity is distinct from old.severity and not v_staff then
      raise exception 'Only JAGS staff can change the severity of an NCR';
    end if;

    -- Assignment / due date / responsible party: staff or the raiser.
    if (new.assigned_to is distinct from old.assigned_to
        or new.due_date is distinct from old.due_date
        or new.responsible_party_id is distinct from old.responsible_party_id)
       and not v_staff and old.raised_by is distinct from v_uid then
      raise exception 'Only the raiser or JAGS staff can change assignment, due date or responsible party';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ncrs_enforce_workflow() from public, anon, authenticated;

drop trigger if exists ncrs_enforce_workflow on public.ncrs;
create trigger ncrs_enforce_workflow
  before update on public.ncrs
  for each row execute function public.ncrs_enforce_workflow();

-- ===== 2. Insert: raised_by is always the caller =====
create or replace function public.ncrs_force_raised_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_system_caller() then
    new.raised_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function public.ncrs_force_raised_by() from public, anon, authenticated;

drop trigger if exists ncrs_force_raised_by on public.ncrs;
create trigger ncrs_force_raised_by
  before insert on public.ncrs
  for each row execute function public.ncrs_force_raised_by();

-- ===== 3. Delete: admin staff only, never a closed NCR =====
create or replace function public.ncrs_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.status = 'closed' then
    raise exception 'A closed NCR cannot be deleted';
  end if;
  if not public.is_admin_staff() then
    raise exception 'Only JAGS admin staff can delete an NCR';
  end if;
  return old;
end;
$$;

revoke all on function public.ncrs_guard_delete() from public, anon, authenticated;

drop trigger if exists ncrs_guard_delete on public.ncrs;
create trigger ncrs_guard_delete
  before delete on public.ncrs
  for each row execute function public.ncrs_guard_delete();

drop policy if exists ncrs_write_d on public.ncrs;
create policy ncrs_write_d on public.ncrs for delete using (
  public.is_admin_staff()
  and status <> 'closed'
  and exists (select 1 from public.projects p where p.id = ncrs.project_id and has_project_access(p.id, p.organization_id))
);

-- ===== 4. Evidence rows: frozen on a closed NCR; photo path must be NCR-scoped =====
create or replace function public.ncr_evidence_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ncr_id uuid;
  v_status text;
  v_project uuid;
  v_prefix text;
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_ncr_id := case when tg_op = 'DELETE' then old.ncr_id else new.ncr_id end;
  select n.status, n.project_id into v_status, v_project from public.ncrs n where n.id = v_ncr_id;
  if v_status = 'closed' then
    raise exception 'This NCR is closed. Re-open it to change evidence.';
  end if;
  -- An UPDATE must not move a row onto (or off) a different NCR.
  if tg_op = 'UPDATE' and new.ncr_id is distinct from old.ncr_id then
    raise exception 'Evidence cannot be moved to another NCR';
  end if;

  if tg_table_name = 'ncr_photos' and tg_op in ('INSERT', 'UPDATE') then
    v_prefix := v_project::text || '/ncrs/' || v_ncr_id::text || '/';
    if v_project is null or left(new.storage_path, length(v_prefix)) <> v_prefix then
      raise exception 'Photo storage path must start with {project_id}/ncrs/{ncr_id}/';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.ncr_evidence_write_guard() from public, anon, authenticated;

drop trigger if exists ncr_photos_write_guard on public.ncr_photos;
create trigger ncr_photos_write_guard
  before insert or update or delete on public.ncr_photos
  for each row execute function public.ncr_evidence_write_guard();

drop trigger if exists ncr_documents_write_guard on public.ncr_documents;
create trigger ncr_documents_write_guard
  before insert or update or delete on public.ncr_documents
  for each row execute function public.ncr_evidence_write_guard();
