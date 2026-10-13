-- DB-level completion guards (checklist part 2: F14, G8, H3). Previously app-code only.
--
-- ROLLBACK NOTE: re-create public.inspection_completion_blocker, public.activity_signoff_progress_guard and
-- public.standalone_assignments_lifecycle_guard from the definitions in the earlier migrations
-- (execution_guards_v2 and later), and optionally `alter table public.activity_signoff_progress drop column
-- on_behalf_reason;`. No data is changed by this migration. Idempotent: safe to re-run.
--
-- Callers with is_system_caller() or pg_trigger_depth() > 1 keep bypassing every guard (unchanged).
-- Inspections already completed are untouched (exec_guard returns early when old.overall_result is not null).

-- ---------------------------------------------------------------------------------------------
-- G8: the reason for signing on behalf of a party needs somewhere to live at DB level.
-- (The app only put it in the activity-log summary.) lib/signoff/actions.ts now also writes it here.
-- ---------------------------------------------------------------------------------------------
alter table public.activity_signoff_progress add column if not exists on_behalf_reason text;

create or replace function public.activity_signoff_progress_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_project uuid;
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return new;
  end if;

  v_project := public.itp_item_project_id(new.itp_item_id);

  if new.status = 'signed_off' and (tg_op = 'INSERT' or old.status is distinct from 'signed_off') then
    -- Signing for your OWN party (linked user or party member): unchanged, no reason needed.
    if exists (
      select 1 from public.project_parties pp
      where pp.id = new.project_party_id
        and pp.is_active
        and (
          pp.user_id = auth.uid()
          or exists (select 1 from public.project_party_members m where m.project_party_id = pp.id and m.user_id = auth.uid())
        )
    ) then
      return new;
    end if;
    -- On behalf of another party: admin or team lead only, and (same as lib/signoff/on-behalf.ts,
    -- MIN_ON_BEHALF_REASON_LENGTH = 10) a written reason of at least 10 characters after trimming.
    if public.is_admin_staff() or public.is_team_lead_for_project(v_project) then
      if length(btrim(coalesce(new.on_behalf_reason, ''))) < 10 then
        raise exception 'A reason is required to sign on behalf of a party (at least 10 characters).' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Only the linked party, an admin or a team lead can sign off this activity' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.status in ('signed_off', 'proceeded_no_response') and new.status in ('pending', 'notified') then
    if not (public.is_admin_staff() or public.is_team_lead_for_project(v_project)) then
      raise exception 'Only an admin or a team lead can withdraw a recorded sign-off' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- F14: un-notified Witness notice blocks completion unless waived for this inspection record.
-- Mirrors lib/checklists/notice-waiver.ts unnotifiedNonBlockingLevels: levels of the project's
-- organisation that are non-blocking AND code 'W'; a progress row for this activity still 'pending'
-- for such a level; waived only by an inspection_notice_waivers row for this record + intervention.
-- ---------------------------------------------------------------------------------------------
create or replace function public.inspection_completion_blocker(target_record_id uuid, proposed_result text, proposed_notes text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_unanswered int;
  v_computed text;
  v_org uuid;
  v_unnotified text;
begin
  select id, itp_item_id, checklist_template_id into r from public.inspection_records where id = target_record_id;
  if not found then
    return 'Inspection record not found';
  end if;

  if public.item_has_open_hold(r.itp_item_id) then
    return 'This activity has an open Hold; it must be signed off before the inspection can be completed';
  end if;

  if r.checklist_template_id is not null then
    if not exists (select 1 from public.checklist_items ci where ci.template_id = r.checklist_template_id) then
      return 'This checklist has no items';
    end if;
    select count(*) into v_unanswered
    from public.checklist_items ci
    where ci.template_id = r.checklist_template_id
      and not exists (
        select 1 from public.checklist_responses cr
        where cr.inspection_record_id = r.id and cr.checklist_item_id = ci.id
      );
    if v_unanswered > 0 then
      return 'Every checklist item needs a response before the inspection can be completed';
    end if;

    select case
      when bool_or(cr.result = 'no') then 'fail'
      when bool_or(cr.result = 'na') then 'partial'
      else 'pass'
    end into v_computed
    from public.checklist_responses cr
    where cr.inspection_record_id = r.id;
    if v_computed is distinct from proposed_result then
      return 'The overall result does not match the recorded answers';
    end if;
  end if;

  if not exists (select 1 from public.inspection_photos ph where ph.inspection_record_id = r.id)
     and not exists (select 1 from public.inspection_evidence_documents ed where ed.inspection_record_id = r.id)
     and coalesce(proposed_notes, '') not like '[No evidence attached%' then
    return 'At least one evidence photo or linked document (or a written no-evidence reason) is required';
  end if;

  -- F14 (new): Witness notice never sent and not waived.
  select p.organization_id into v_org
  from public.itp_items ii
  join public.itp_sections s on s.id = ii.section_id
  join public.itps i on i.id = s.itp_id
  join public.projects p on p.id = i.project_id
  where ii.id = r.itp_item_id;

  if v_org is not null then
    select string_agg(distinct lt.label, ', ') into v_unnotified
    from public.activity_signoff_progress asp
    join public.intervention_level_types lt
      on lt.organization_id = v_org and lt.code = asp.intervention and lt.code = 'W' and lt.is_blocking = false
    where asp.itp_item_id = r.itp_item_id
      and asp.status = 'pending'
      and not exists (
        select 1 from public.inspection_notice_waivers w
        where w.inspection_record_id = r.id and w.intervention = asp.intervention
      );
    if v_unnotified is not null then
      return 'Notify the ' || v_unnotified || ' party before completing this inspection (Sign-off tab on the ITP).';
    end if;
  end if;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- H3: standalone assignment (FAT/SAT) cannot be finalized as a clean Pass while a measurement has no
-- result or failed (mirrors finalize logic in lib/standalone/actions.ts). Conditional Pass / Fail unaffected.
-- ---------------------------------------------------------------------------------------------
create or replace function public.standalone_assignments_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' or new.conclusion is not null then
      raise exception 'A new standalone assignment must start as a draft' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft standalone assignment can be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if new.status is not distinct from old.status then
    if new.conclusion is distinct from old.conclusion then
      raise exception 'The conclusion can only change when the assignment is finalized or reopened' using errcode = '42501';
    end if;
    if old.status = 'completed' then
      if public.is_jags_staff()
         and (to_jsonb(new) - 'narrative' - 'updated_at') = (to_jsonb(old) - 'narrative' - 'updated_at') then
        return new;
      end if;
      raise exception 'This assignment is completed and locked' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status in ('completed', 'conditional_open') then
    if new.conclusion = 'pass' and exists (
      select 1 from public.standalone_assignment_measurements m
      where m.assignment_id = old.id and (m.result is null or m.result = 'fail')
    ) then
      raise exception 'A Pass needs every measurement recorded and passing; use Conditional Pass or Fail instead' using errcode = '42501';
    end if;
    return new;
  elsif old.status = 'conditional_open' and new.status = 'completed' then
    return new;
  elsif old.status = 'conditional_open' and new.status = 'draft' then
    return new;
  elsif old.status = 'completed' and new.status = 'draft' then
    if public.is_admin_staff() then
      return new;
    end if;
    raise exception 'Only an admin can reopen a completed assignment' using errcode = '42501';
  end if;

  raise exception 'Invalid status change from % to %', old.status, new.status using errcode = '42501';
end;
$function$;
