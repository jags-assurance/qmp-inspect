-- Stage 5: punch list write guards, version 2 (replaces 20261016S50002's functions; same trigger names).
-- Depends on 20261102000200 (columns + helpers) and 20261015S40001 (is_system_caller).
--
--   S5-08  source_* links are validated on insert and immutable afterwards; the NCR close/re-open
--          cascade carve-out only applies when the source NCR really is closed / re-opened, so a
--          forged source_ncr_id cannot be used to close an item without close_punch_item.
--          due_date / responsible_party_id / priority / location / description edits are limited to
--          verifiers, staff and (for NCR-sourced items) people who work the source NCR.
--   S5-05  the source NCR's assignee and responsible-party team members may resolve its punch item.
--   S5-17  withdraw (raised in error / duplicate): guarded close with a reason.
-- Exemptions: public.is_system_caller() and pg_trigger_depth() > 1. Idempotent.

create or replace function public.punch_list_items_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() then
    return new;
  end if;
  new.created_by := auth.uid();
  if new.status is distinct from 'open' then
    raise exception 'A new punch item must start as open';
  end if;
  new.resolved_by := null; new.resolved_at := null;
  new.closed_by := null;   new.closed_at := null;
  new.reopened_by := null; new.reopened_at := null;
  new.withdrawn_at := null; new.withdrawn_by := null; new.withdrawn_reason := null;

  -- Source links must point at records of THIS project (and, for an NCR, one the caller works).
  if new.source_ncr_id is not null then
    if not exists (select 1 from public.ncrs n where n.id = new.source_ncr_id and n.project_id = new.project_id) then
      raise exception 'The source NCR does not belong to this project';
    end if;
    if not public.can_work_ncr(new.source_ncr_id) then
      raise exception 'Only someone who works the source NCR can link a punch item to it';
    end if;
  end if;
  if new.source_inspection_record_id is not null and not exists (
    select 1 from public.inspection_records r where r.id = new.source_inspection_record_id and r.project_id = new.project_id
  ) then
    raise exception 'The source inspection does not belong to this project';
  end if;
  if new.source_standalone_assignment_id is not null and not exists (
    select 1 from public.standalone_assignments a where a.id = new.source_standalone_assignment_id and a.project_id = new.project_id
  ) then
    raise exception 'The source assignment does not belong to this project';
  end if;
  if new.source_itp_item_id is not null and public.itp_item_project_id(new.source_itp_item_id) is distinct from new.project_id then
    raise exception 'The source ITP item does not belong to this project';
  end if;
  if new.walkdown_id is not null and not exists (
    select 1 from public.walkdowns w where w.id = new.walkdown_id and w.project_id = new.project_id
  ) then
    raise exception 'The walkdown does not belong to this project';
  end if;
  return new;
end;
$$;

revoke all on function public.punch_list_items_guard_insert() from public, anon, authenticated;

drop trigger if exists punch_list_items_guard_insert on public.punch_list_items;
create trigger punch_list_items_guard_insert
  before insert on public.punch_list_items
  for each row execute function public.punch_list_items_guard_insert();

create or replace function public.punch_list_items_guard_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_guarded boolean := not (public.is_system_caller() or pg_trigger_depth() > 1);
  v_staff boolean;
  v_closer boolean;
  v_ncr_status text;
  v_ncr_assignee uuid;
  v_ncr_worker boolean := false;
  v_withdraw boolean;
  v_cascade_close boolean := false;
  v_cascade_reopen boolean := false;
begin
  if v_guarded then
    v_staff := public.is_jags_staff();
    v_closer := public.is_admin_staff()
      or public.has_custom_permission(v_uid, 'close_punch_item', old.project_id);

    if old.source_ncr_id is not null then
      select n.status, n.assigned_to into v_ncr_status, v_ncr_assignee from public.ncrs n where n.id = old.source_ncr_id;
      v_ncr_worker := public.can_work_ncr(old.source_ncr_id);
      -- The NCR close-out cascade: only while the source NCR really is closed (and re-open: no longer closed).
      v_cascade_close := (v_staff or public.can_close_ncr(old.project_id)) and old.status in ('open', 'resolved') and v_ncr_status = 'closed';
      v_cascade_reopen := (v_staff or public.can_close_ncr(old.project_id)) and old.status = 'closed' and v_ncr_status is distinct from 'closed';
    end if;

    if new.project_id is distinct from old.project_id then
      raise exception 'project_id cannot be changed';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by cannot be changed';
    end if;
    if new.source is distinct from old.source
       or new.source_ncr_id is distinct from old.source_ncr_id
       or new.source_inspection_record_id is distinct from old.source_inspection_record_id
       or new.source_standalone_assignment_id is distinct from old.source_standalone_assignment_id
       or new.source_itp_item_id is distinct from old.source_itp_item_id then
      raise exception 'The source of a punch item cannot be changed';
    end if;

    -- Planning columns: verifiers, staff, or whoever works the source NCR.
    if (new.due_date is distinct from old.due_date
        or new.responsible_party_id is distinct from old.responsible_party_id
        or new.priority is distinct from old.priority
        or new.location is distinct from old.location
        or new.description is distinct from old.description)
       and not (v_closer or v_staff or v_ncr_worker) then
      raise exception 'Only a punch item verifier, JAGS staff or the source NCR''s team can change the item''s details';
    end if;

    -- Actor/time stamps are server-owned: start from the old values, override per transition.
    new.resolved_by := old.resolved_by; new.resolved_at := old.resolved_at;
    new.closed_by := old.closed_by;     new.closed_at := old.closed_at;
    new.reopened_by := old.reopened_by; new.reopened_at := old.reopened_at;

    v_withdraw := new.withdrawn_at is not null and old.withdrawn_at is null;
    if not v_withdraw then
      new.withdrawn_at := old.withdrawn_at; new.withdrawn_by := old.withdrawn_by; new.withdrawn_reason := old.withdrawn_reason;
    end if;

    if new.status is not distinct from old.status then
      if v_withdraw then
        raise exception 'A punch item is withdrawn by closing it';
      end if;
      if old.status = 'closed'
         and (new.closing_evidence is distinct from old.closing_evidence
              or new.verification_notes is distinct from old.verification_notes
              or new.closing_photo_paths is distinct from old.closing_photo_paths) then
        raise exception 'Closing evidence cannot be edited once the punch item is closed';
      end if;
    elsif v_withdraw then
      if new.status <> 'closed' or old.status = 'closed' then
        raise exception 'Only an open or resolved punch item can be withdrawn';
      end if;
      if length(btrim(coalesce(new.withdrawn_reason, ''))) < 5 then
        raise exception 'A reason (at least 5 characters) is required to withdraw a punch item';
      end if;
      if not (v_closer or v_staff or old.created_by is not distinct from v_uid or v_cascade_close) then
        raise exception 'Only a punch item verifier, JAGS staff or the creator can withdraw a punch item';
      end if;
      new.withdrawn_by := v_uid;
      new.closed_by := v_uid;
      new.closed_at := now();
      return new;
    else
      if old.withdrawn_at is not null then
        raise exception 'A withdrawn punch item cannot be changed';
      end if;
      if new.status = 'resolved' and old.status = 'open' then
        if not (v_staff or v_closer
                or public.is_party_user(old.responsible_party_id)
                or v_ncr_assignee is not distinct from v_uid) then
          raise exception 'Only the responsible party, JAGS staff or a punch item verifier can mark an item resolved';
        end if;
        if coalesce(btrim(new.closing_evidence), '') = '' then
          raise exception 'Evidence of what was done is required before this item can be marked resolved';
        end if;
        new.resolved_by := v_uid;
        new.resolved_at := now();
      elsif new.status = 'closed' then
        if not (v_closer or v_cascade_close) then
          raise exception 'Only a JAGS admin or a holder of close_punch_item can close a punch item';
        end if;
        new.closed_by := v_uid;
        new.closed_at := now();
      elsif new.status = 'open' then
        if not (v_closer or v_cascade_reopen) then
          raise exception 'Only a JAGS admin or a holder of close_punch_item can reopen a punch item';
        end if;
        new.reopened_by := v_uid;
        new.reopened_at := now();
        new.closed_by := null;   new.closed_at := null;
        new.resolved_by := null; new.resolved_at := null;
      end if;
    end if;
  end if;

  -- ---- transition rules (20261013N20001); different-person rule skipped for NCR-sourced items ----
  if new.status is distinct from old.status then
    if old.status = 'open' and new.status = 'closed' and old.source_ncr_id is null then
      raise exception 'A punch item must be resolved before it can be closed';
    end if;
    if new.status = 'closed' then
      if coalesce(btrim(new.verification_notes), '') = '' then
        raise exception 'Verification notes are required to close a punch item';
      end if;
      if old.source_ncr_id is null and new.closed_by is not null and new.closed_by = old.resolved_by then
        raise exception 'A different person must verify and close a punch item';
      end if;
    end if;
    if old.status = 'closed' and new.status <> 'open' then
      raise exception 'A closed punch item can only be reopened';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.punch_list_items_guard_transition() from public, anon, authenticated;

drop trigger if exists punch_list_items_guard_transition on public.punch_list_items;
create trigger punch_list_items_guard_transition
  before update on public.punch_list_items
  for each row execute function public.punch_list_items_guard_transition();
