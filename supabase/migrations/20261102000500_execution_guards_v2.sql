-- Stage 4: database-layer mirror of the site-execution rules that so far lived only in server
-- actions. All additions are NEW triggers/functions (nothing already deployed is redefined except
-- activity_signoff_progress_guard), so they compose with other guards on the same tables.
-- Exemptions everywhere: public.is_system_caller() and pg_trigger_depth() > 1. Idempotent.
--
--   S4-01  inspection_records / checklist_responses / inspection_photos: only the executing party
--          (or staff) may start, answer and complete an inspection; completion needs a signature,
--          every item answered, a result matching the answers, evidence (or the written waiver) and
--          no open Hold. A viewer / unrelated subcontractor can no longer PATCH a record to 'pass'.
--   S4-09  activity_signoff_progress: signing on behalf and withdrawing a sign-off need admin staff
--          or a team lead of the project (not any staff); the party's team members may sign for it.
--   S4-10  party team members (project_party_members) count as the party for sign-off.
--   S4-12  irns: insert gate mirrors issueIrnAction (no open Hold, no mandatory N/A on a partial
--          result, no open NCR raised from the inspection).

-- ===== helpers =====

create or replace function public.is_team_lead_for_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_project_assignments tpa
    join public.team_members tm on tm.team_id = tpa.team_id
    where tpa.project_id = target_project_id
      and tm.user_id = auth.uid()
      and tm.is_team_lead
  );
$$;
revoke all on function public.is_team_lead_for_project(uuid) from public, anon;
grant execute on function public.is_team_lead_for_project(uuid) to authenticated, service_role;

-- Exact mirror of canExecuteItpItem (apps/web/lib/checklists/execution-parties.ts).
create or replace function public.can_execute_itp_item(target_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_jags_staff()
    or exists (
      select 1
      from public.activity_party_intervention api
      join public.project_parties pp on pp.id = api.project_party_id
      join public.projects p on p.id = pp.project_id
      join public.organizations o on o.id = p.organization_id
      where api.itp_item_id = target_item_id
        and pp.project_id = public.itp_item_project_id(target_item_id)
        and pp.is_active
        and (
          pp.party_type in ('subcontractor', 'main_contractor')
          or (
            pp.party_type = 'client'
            and (p.allow_client_execution or o.engagement_scope in ('self_managed', 'client_managed'))
          )
        )
        and (
          pp.user_id = auth.uid()
          or exists (
            select 1 from public.project_party_members m
            where m.project_party_id = pp.id and m.user_id = auth.uid()
          )
        )
    );
$$;
revoke all on function public.can_execute_itp_item(uuid) from public, anon;
grant execute on function public.can_execute_itp_item(uuid) to authenticated, service_role;

-- True when any blocking-level (Hold-equivalent) sign-off on the activity is not signed off yet.
create or replace function public.item_has_open_hold(target_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.activity_signoff_progress sp
    join public.itp_items it on it.id = sp.itp_item_id
    join public.itp_sections s on s.id = it.section_id
    join public.itps i on i.id = s.itp_id
    join public.projects p on p.id = i.project_id
    join public.intervention_level_types lt on lt.organization_id = p.organization_id and lt.code = sp.intervention
    where sp.itp_item_id = target_item_id
      and lt.is_blocking
      and sp.status <> 'signed_off'
  );
$$;
revoke all on function public.item_has_open_hold(uuid) from public, anon;
grant execute on function public.item_has_open_hold(uuid) to authenticated, service_role;

-- First reason a record cannot be completed with the given result, or null when it can.
create or replace function public.inspection_completion_blocker(target_record_id uuid, proposed_result text, proposed_notes text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_unanswered int;
  v_computed text;
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

  return null;
end;
$$;
revoke all on function public.inspection_completion_blocker(uuid, text, text) from public, anon;
grant execute on function public.inspection_completion_blocker(uuid, text, text) to authenticated, service_role;

-- ===== S4-01: inspection_records =====
create or replace function public.inspection_records_exec_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blocker text;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.can_execute_itp_item(new.itp_item_id) then
      raise exception 'Only JAGS staff or the party assigned to this activity can start an inspection' using errcode = '42501';
    end if;
    if public.itp_item_project_id(new.itp_item_id) is distinct from new.project_id then
      raise exception 'The activity does not belong to this project' using errcode = '42501';
    end if;
    if new.checklist_template_id is not null and not exists (
      select 1 from public.checklist_templates t where t.id = new.checklist_template_id and t.itp_item_id = new.itp_item_id
    ) then
      raise exception 'The checklist does not belong to this activity' using errcode = '42501';
    end if;
    if new.overall_result is not null then
      raise exception 'An inspection is completed through the completion step, not created completed' using errcode = '42501';
    end if;
    new.inspector_id := auth.uid();
    return new;
  end if;

  -- UPDATE
  if new.itp_item_id is distinct from old.itp_item_id or new.project_id is distinct from old.project_id then
    raise exception 'An inspection cannot be moved to another activity or project' using errcode = '42501';
  end if;
  if old.overall_result is not null then
    return new; -- completed: inspection_records_write_guard decides (re-open / narrative only)
  end if;
  if not public.can_execute_itp_item(old.itp_item_id) then
    raise exception 'Only JAGS staff or the party assigned to this activity can change this inspection' using errcode = '42501';
  end if;

  if new.overall_result is not null then
    -- Completion.
    if new.inspector_signature is null or new.inspector_signature not like 'data:image/%' then
      raise exception 'A signature is required to complete the inspection' using errcode = '42501';
    end if;
    v_blocker := public.inspection_completion_blocker(old.id, new.overall_result, new.notes);
    if v_blocker is not null then
      raise exception '%', v_blocker using errcode = '42501';
    end if;
    new.signed_by_user_id := auth.uid();
    if new.signed_at is null or new.signed_at > now() + interval '5 minutes' then
      new.signed_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.inspection_records_exec_guard() from public, anon, authenticated;

drop trigger if exists inspection_records_exec_guard on public.inspection_records;
create trigger inspection_records_exec_guard
  before insert or update on public.inspection_records
  for each row execute function public.inspection_records_exec_guard();

-- ===== S4-01: checklist_responses and inspection_photos =====
create or replace function public.inspection_child_exec_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record uuid;
  v_item uuid;
  v_template uuid;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return coalesce(new, old);
  end if;

  v_record := case when tg_op = 'DELETE' then old.inspection_record_id else new.inspection_record_id end;
  select itp_item_id, checklist_template_id into v_item, v_template
    from public.inspection_records where id = v_record;
  if v_item is null then
    raise exception 'Inspection not found' using errcode = '42501';
  end if;
  if not public.can_execute_itp_item(v_item) then
    raise exception 'Only JAGS staff or the party assigned to this activity can record on this inspection' using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'UPDATE' and new.inspection_record_id is distinct from old.inspection_record_id then
      raise exception 'Evidence cannot be moved to another inspection' using errcode = '42501';
    end if;
    -- A checklist answer / item photo must point at an item of THIS inspection's checklist.
    if new.checklist_item_id is not null and v_template is not null and not exists (
      select 1 from public.checklist_items ci where ci.id = new.checklist_item_id and ci.template_id = v_template
    ) then
      raise exception 'That item is not part of this inspection''s checklist' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.inspection_child_exec_guard() from public, anon, authenticated;

drop trigger if exists checklist_responses_exec_guard on public.checklist_responses;
create trigger checklist_responses_exec_guard
  before insert or update or delete on public.checklist_responses
  for each row execute function public.inspection_child_exec_guard();

drop trigger if exists inspection_photos_exec_guard on public.inspection_photos;
create trigger inspection_photos_exec_guard
  before insert or update or delete on public.inspection_photos
  for each row execute function public.inspection_child_exec_guard();

-- ===== S4-09 / S4-10: activity_signoff_progress =====
create or replace function public.activity_signoff_progress_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return new;
  end if;

  v_project := public.itp_item_project_id(new.itp_item_id);

  if new.status = 'signed_off' and (tg_op = 'INSERT' or old.status is distinct from 'signed_off') then
    -- The party's own login, or one of its team members (S4-10).
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
    -- On behalf of a party: admin staff or a team lead of the project (S4-09).
    if public.is_admin_staff() or public.is_team_lead_for_project(v_project) then
      return new;
    end if;
    raise exception 'Only the linked party, an admin or a team lead can sign off this activity' using errcode = '42501';
  end if;

  -- Withdrawing a recorded sign-off (signed_off / proceeded -> pending): admin staff or team lead only.
  if tg_op = 'UPDATE' and old.status in ('signed_off', 'proceeded_no_response') and new.status in ('pending', 'notified') then
    if not (public.is_admin_staff() or public.is_team_lead_for_project(v_project)) then
      raise exception 'Only an admin or a team lead can withdraw a recorded sign-off' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.activity_signoff_progress_guard() from public, anon;

drop trigger if exists activity_signoff_progress_guard on public.activity_signoff_progress;
create trigger activity_signoff_progress_guard
  before insert or update on public.activity_signoff_progress
  for each row execute function public.activity_signoff_progress_guard();

-- ===== S4-12: IRN issue gates (separate trigger; leaves irns_write_guard untouched) =====
create or replace function public.irns_issue_gates_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  select id, itp_item_id, overall_result, checklist_template_id into r
    from public.inspection_records where id = new.inspection_record_id;
  if not found then
    return new;
  end if;

  if public.item_has_open_hold(r.itp_item_id) then
    raise exception 'This activity has an open Hold; it must be signed off before an IRN can be issued' using errcode = '42501';
  end if;

  if r.overall_result = 'partial' and r.checklist_template_id is not null and exists (
    select 1
    from public.checklist_responses cr
    join public.checklist_items ci on ci.id = cr.checklist_item_id
    where cr.inspection_record_id = r.id and cr.result = 'na' and ci.is_mandatory
  ) then
    raise exception 'An IRN cannot be issued while a mandatory checklist item is marked N/A' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.ncrs n
    where n.inspection_record_id = r.id and n.severity <> 'observation' and n.status <> 'closed'
  ) then
    raise exception 'An NCR raised from this inspection is still open; close it before issuing the IRN' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.irns_issue_gates_guard() from public, anon, authenticated;

drop trigger if exists irns_issue_gates_guard on public.irns;
create trigger irns_issue_gates_guard
  before insert on public.irns
  for each row execute function public.irns_issue_gates_guard();
