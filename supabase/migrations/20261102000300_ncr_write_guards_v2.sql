-- Stage 5: NCR write guards, version 2. Replaces ncrs_enforce_workflow (20261016S50001) and
-- ncr_evidence_write_guard so the database matches the app's rules exactly (lib/ncrs/actions.ts,
-- lib/ncrs/rules.ts). Depends on 20261102000200 (columns + helpers) and 20261015S40001 (is_system_caller).
--
--   S5-03  responsible party (and its team members) may start work / send for verification
--   S5-04  close / re-open authority = admin staff OR close_ncr permission holder (not any staff)
--   S5-06  evidence link / unlink / photo: only people who can work the NCR, locked while awaiting verification
--   S5-07  content columns guarded (description, CAPA, linkage); FK links must belong to the project;
--          new rows always start open
--   S5-09  sending for verification needs root cause + corrective + preventive action AND evidence
--   S5-12  assignee / CAPA author cannot verify their own work (admins may, with an override reason in the app)
--   S5-17  withdraw (raised in error / duplicate) as a guarded close
-- Exemptions: public.is_system_caller() and pg_trigger_depth() > 1. Idempotent.

create or replace function public.ncrs_enforce_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_closer boolean;
  v_worker boolean;
  v_withdraw boolean;
  v_capa_changed boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if public.is_system_caller() or pg_trigger_depth() > 1 then
    if new.status = 'closed' and old.status <> 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
    return new;
  end if;

  v_staff := public.is_jags_staff();
  v_closer := public.is_admin_staff() or public.has_custom_permission(v_uid, 'close_ncr', old.project_id);
  v_worker := v_staff
    or old.raised_by is not distinct from v_uid
    or old.assigned_to is not distinct from v_uid
    or public.is_party_user(old.responsible_party_id);

  -- Identity and linkage columns never change after raise.
  if new.raised_by is distinct from old.raised_by then raise exception 'raised_by cannot be changed'; end if;
  if new.ncr_number is distinct from old.ncr_number then raise exception 'ncr_number cannot be changed'; end if;
  if new.project_id is distinct from old.project_id then raise exception 'project_id cannot be changed'; end if;
  if new.itp_item_id is distinct from old.itp_item_id
     or new.inspection_record_id is distinct from old.inspection_record_id
     or new.checklist_item_id is distinct from old.checklist_item_id then
    raise exception 'The source inspection links of an NCR cannot be changed';
  end if;

  -- ---- a closed NCR is immutable except for a re-open ----
  if old.status = 'closed' then
    if new.status not in ('open', 'in_progress') then
      raise exception 'Closed NCR cannot be modified';
    end if;
    if old.withdrawn_at is not null then
      raise exception 'A withdrawn NCR cannot be re-opened';
    end if;
    if not v_closer then
      raise exception 'Only a JAGS admin or a close NCR permission holder can re-open an NCR';
    end if;
    new.closed_by := null;
    new.closed_at := null;
    new.withdrawn_at := null; new.withdrawn_by := null; new.withdrawn_reason := null; new.duplicate_of_ncr_id := null;
    return new;
  end if;

  -- Server-owned columns.
  v_withdraw := new.withdrawn_at is not null and old.withdrawn_at is null;
  if not v_withdraw then
    new.withdrawn_at := old.withdrawn_at; new.withdrawn_by := old.withdrawn_by;
    new.withdrawn_reason := old.withdrawn_reason; new.duplicate_of_ncr_id := old.duplicate_of_ncr_id;
  end if;
  if new.capa_updated_by is distinct from old.capa_updated_by then
    new.capa_updated_by := old.capa_updated_by;
  end if;

  -- ---- withdraw: guarded close, no CAPA / evidence needed ----
  if v_withdraw then
    if new.status <> 'closed' then
      raise exception 'An NCR is withdrawn by closing it';
    end if;
    if length(btrim(coalesce(new.withdrawn_reason, ''))) < 5 then
      raise exception 'A reason (at least 5 characters) is required to withdraw an NCR';
    end if;
    if not (v_closer or (old.raised_by is not distinct from v_uid and old.status = 'open')) then
      raise exception 'Only a JAGS admin, a close NCR permission holder, or the raiser of a not-yet-started NCR can withdraw it';
    end if;
    new.withdrawn_by := v_uid;
    new.closed_by := v_uid;
    new.closed_at := now();
    return new;
  end if;

  -- ---- status machine: open -> in_progress -> pending_verification -> closed ----
  if new.status is distinct from old.status then
    if not ((old.status = 'open' and new.status = 'in_progress')
         or (old.status = 'in_progress' and new.status = 'pending_verification')
         or (old.status = 'pending_verification' and new.status = 'closed')
         or (old.status = 'pending_verification' and new.status = 'in_progress')) then
      raise exception 'Invalid NCR status change from % to %', old.status, new.status;
    end if;

    if old.status = 'pending_verification' and new.status = 'in_progress' and not v_staff then
      raise exception 'Only JAGS staff can return an NCR from verification';
    end if;

    if new.status in ('in_progress', 'pending_verification') and old.status in ('open', 'in_progress') and not v_worker then
      raise exception 'Only the raiser, the assignee, the responsible party or JAGS staff can update this NCR';
    end if;

    if new.status = 'pending_verification' then
      if coalesce(btrim(new.root_cause), '') = '' or coalesce(btrim(new.corrective_action), '') = ''
         or coalesce(btrim(new.preventive_action), '') = '' then
        raise exception 'Root cause, corrective action and preventive action are required before sending for verification';
      end if;
      if not exists (select 1 from public.ncr_photos where ncr_id = new.id)
         and not exists (select 1 from public.ncr_documents where ncr_id = new.id) then
        raise exception 'Attach at least one photo or linked document as evidence before sending for verification';
      end if;
    end if;

    if new.status = 'closed' then
      if not v_closer then
        raise exception 'Only a JAGS admin or a close NCR permission holder can close an NCR';
      end if;
      if coalesce(btrim(new.root_cause), '') = '' or coalesce(btrim(new.corrective_action), '') = ''
         or coalesce(btrim(new.preventive_action), '') = '' or coalesce(btrim(new.verification_notes), '') = '' then
        raise exception 'Root cause, corrective action, preventive action and verification notes are required to close';
      end if;
      if old.raised_by is not null and old.raised_by = v_uid and not public.is_admin_staff() then
        raise exception 'The person who raised an NCR cannot close it';
      end if;
      if not public.is_admin_staff()
         and (old.assigned_to is not distinct from v_uid or old.capa_updated_by is not distinct from v_uid) then
        raise exception 'The assignee or the author of the corrective action cannot verify their own work';
      end if;
      if not exists (select 1 from public.ncr_photos where ncr_id = new.id)
         and not exists (select 1 from public.ncr_documents where ncr_id = new.id) then
        raise exception 'At least one evidence photo or linked document is required to close';
      end if;
      new.closed_by := v_uid;
      new.closed_at := now();
    end if;
  else
    -- No status change: closure stamps cannot be edited.
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
  end if;

  -- ---- column guards ----
  if new.severity is distinct from old.severity and not v_staff then
    raise exception 'Only JAGS staff can change the severity of an NCR';
  end if;

  if (new.assigned_to is distinct from old.assigned_to
      or new.due_date is distinct from old.due_date
      or new.responsible_party_id is distinct from old.responsible_party_id)
     and not v_staff and old.raised_by is distinct from v_uid then
    raise exception 'Only the raiser or JAGS staff can change assignment, due date or responsible party';
  end if;

  -- What was found: the raiser or staff, until the NCR is awaiting verification.
  if (new.description is distinct from old.description
      or new.requirement_not_met is distinct from old.requirement_not_met
      or new.location is distinct from old.location
      or new.equipment_tag is distinct from old.equipment_tag
      or new.spec_reference is distinct from old.spec_reference) then
    if not (v_staff or old.raised_by is not distinct from v_uid) then
      raise exception 'Only the raiser or JAGS staff can change what the NCR describes';
    end if;
    if old.status not in ('open', 'in_progress') then
      raise exception 'The NCR description is locked once it is awaiting verification';
    end if;
  end if;

  -- CAPA text: anyone who can work the NCR; locked while awaiting verification for everyone but
  -- staff and close authority holders (who verify it).
  v_capa_changed := new.root_cause is distinct from old.root_cause
    or new.corrective_action is distinct from old.corrective_action
    or new.preventive_action is distinct from old.preventive_action;
  if v_capa_changed
     or new.verification_notes is distinct from old.verification_notes
     or new.root_cause_category is distinct from old.root_cause_category
     or new.disposition is distinct from old.disposition
     or new.cost_impact is distinct from old.cost_impact
     or new.schedule_impact_days is distinct from old.schedule_impact_days
     or new.contractor_response is distinct from old.contractor_response then
    if not (v_worker or v_closer) then
      raise exception 'Only the raiser, the assignee, the responsible party or JAGS staff can update the corrective action';
    end if;
    if old.status = 'pending_verification' and not (v_staff or v_closer) then
      raise exception 'The corrective action is locked while the NCR is awaiting verification';
    end if;
  end if;
  if v_capa_changed then
    new.capa_updated_by := v_uid;
  end if;

  return new;
end;
$$;

revoke all on function public.ncrs_enforce_workflow() from public, anon, authenticated;

drop trigger if exists ncrs_enforce_workflow on public.ncrs;
create trigger ncrs_enforce_workflow
  before update on public.ncrs
  for each row execute function public.ncrs_enforce_workflow();

-- ===== Insert: raised_by is the caller; always starts open; links must belong to the project =====
create or replace function public.ncrs_force_raised_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() then
    return new;
  end if;
  new.raised_by := auth.uid();
  new.status := 'open';
  new.closed_by := null;
  new.closed_at := null;
  new.withdrawn_at := null; new.withdrawn_by := null; new.withdrawn_reason := null; new.duplicate_of_ncr_id := null;
  new.capa_updated_by := null;
  new.close_override_reason := null;
  new.reopen_count := 0;
  new.last_reopen_reason := null;

  if new.itp_item_id is not null and public.itp_item_project_id(new.itp_item_id) is distinct from new.project_id then
    raise exception 'The linked ITP item does not belong to this project';
  end if;
  if new.inspection_record_id is not null and not exists (
    select 1 from public.inspection_records r where r.id = new.inspection_record_id and r.project_id = new.project_id
  ) then
    raise exception 'The linked inspection does not belong to this project';
  end if;
  if new.checklist_item_id is not null and not exists (
    select 1
    from public.checklist_items ci
    join public.inspection_records r on r.checklist_template_id = ci.template_id
    where ci.id = new.checklist_item_id and r.id = new.inspection_record_id
  ) then
    raise exception 'The linked checklist item does not belong to that inspection';
  end if;
  return new;
end;
$$;

revoke all on function public.ncrs_force_raised_by() from public, anon, authenticated;

drop trigger if exists ncrs_force_raised_by on public.ncrs;
create trigger ncrs_force_raised_by
  before insert on public.ncrs
  for each row execute function public.ncrs_force_raised_by();

-- ===== Evidence rows =====
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
  if tg_op = 'UPDATE' and new.ncr_id is distinct from old.ncr_id then
    raise exception 'Evidence cannot be moved to another NCR';
  end if;

  -- Only people who work the NCR change its evidence, and not while it awaits verification
  -- (except staff / close authority, who verify it).
  if not public.can_work_ncr(v_ncr_id) then
    raise exception 'Only the raiser, the assignee, the responsible party or JAGS staff can change this NCR''s evidence';
  end if;
  if v_status = 'pending_verification' and not (public.is_jags_staff() or public.can_close_ncr(v_project)) then
    raise exception 'The NCR is awaiting verification; its evidence is locked';
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
