-- Stage 2 (ITP) hardening. Idempotent.
--
-- S2-01  A section with inspection history can no longer be deleted (the item history guard lets cascades
--        through, so the guard has to sit on the section too).
-- S2-05  Changing / clearing a party's intervention level keeps activity_signoff_progress in step; once a
--        point is signed off the level can't be changed or cleared.
-- S2-07  Intervention and expected-record write policies are PROJECT-scoped again (has_project_access),
--        not "any grant in the organisation".
-- S2-03  itps.client_accepted_revision; accept_itp refuses while a revision awaits approval and records the
--        revision accepted; a content revision approval can send a client-accepted ITP back to "approved"
--        so the client has to re-accept; field inspections can't be opened while a revision is unapproved.
-- S2-08  ITP statuses superseded / withdrawn (reason, who, when, replacement) as controlled exits.
-- S2-13  Review rounds are archived instead of vanishing when an ITP is returned to draft.
-- S2-12  Review progress records who actually signed (signed_by) when that differs from the named reviewer.
-- S2-17  itps.translations for stored translations.
-- S2-18  itps.master_template_id / master_template_version link an ITP to the library template it came from.
-- S2-19  itp_signoff_counts(): sign-off totals aggregated in SQL (no row cap).

-- ===== helper =====
create or replace function public.itp_item_project_access(target_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
    where it.id = target_item_id
      and public.has_project_access(p.id, p.organization_id)
  );
$$;
revoke all on function public.itp_item_project_access(uuid) from public, anon;
grant execute on function public.itp_item_project_access(uuid) to authenticated, service_role;

-- ===== S2-01: section delete guard =====
create or replace function public.itp_sections_protect_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() then
    return old;
  end if;
  if exists (
    select 1 from public.itp_items it
    where it.section_id = old.id
      and (
        exists (select 1 from public.inspection_records r where r.itp_item_id = it.id)
        or exists (select 1 from public.activity_signoff_progress sp where sp.itp_item_id = it.id and sp.status in ('signed_off', 'proceeded_no_response'))
        or exists (select 1 from public.itp_item_measurements m where m.itp_item_id = it.id and m.actual_value is not null)
        or exists (select 1 from public.itp_item_evidence_documents e where e.itp_item_id = it.id)
        or exists (select 1 from public.ncrs n where n.itp_item_id = it.id)
      )
  ) then
    raise exception 'This section has activities with inspection, sign-off, NCR or evidence history and cannot be deleted' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function public.itp_sections_protect_history() from public, anon;
drop trigger if exists itp_sections_protect_history on public.itp_sections;
create trigger itp_sections_protect_history before delete on public.itp_sections
  for each row execute function public.itp_sections_protect_history();

-- ===== S2-05: keep sign-off rows in step with the intervention grid =====
create or replace function public.sync_signoff_on_intervention_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  -- Cascades (an activity or party being deleted) and system jobs are not edits of the grid.
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select status into v_status from public.activity_signoff_progress
    where itp_item_id = old.itp_item_id and project_party_id = old.project_party_id;

  if tg_op = 'UPDATE' then
    if new.intervention is distinct from old.intervention then
      if v_status in ('signed_off', 'proceeded_no_response') then
        raise exception 'This point has already been signed off, so its level can no longer be changed' using errcode = 'P0001';
      end if;
      update public.activity_signoff_progress
        set intervention = new.intervention
        where itp_item_id = old.itp_item_id and project_party_id = old.project_party_id;
    end if;
    return new;
  end if;

  -- DELETE
  if v_status in ('signed_off', 'proceeded_no_response') then
    raise exception 'This point has already been signed off, so its level can no longer be cleared' using errcode = 'P0001';
  end if;
  delete from public.activity_signoff_progress
    where itp_item_id = old.itp_item_id and project_party_id = old.project_party_id;
  return old;
end;
$$;
revoke all on function public.sync_signoff_on_intervention_change() from public, anon, authenticated;

drop trigger if exists activity_party_intervention_sync_signoff_change on public.activity_party_intervention;
create trigger activity_party_intervention_sync_signoff_change
  before update or delete on public.activity_party_intervention
  for each row execute function public.sync_signoff_on_intervention_change();

-- Orphans left by the old behaviour: sign-off rows whose intervention row is gone, never acted on.
delete from public.activity_signoff_progress sp
where sp.status in ('pending', 'notified')
  and not exists (
    select 1 from public.activity_party_intervention ap
    where ap.itp_item_id = sp.itp_item_id and ap.project_party_id = sp.project_party_id
  );
-- ... and rows whose level drifted from the grid.
update public.activity_signoff_progress sp
set intervention = ap.intervention
from public.activity_party_intervention ap
where ap.itp_item_id = sp.itp_item_id and ap.project_party_id = sp.project_party_id
  and sp.intervention is distinct from ap.intervention
  and sp.status in ('pending', 'notified');

-- ===== S2-07: project-scoped policies =====
drop policy if exists activity_party_intervention_select on public.activity_party_intervention;
create policy activity_party_intervention_select on public.activity_party_intervention
  for select using (
    public.itp_item_project_access(itp_item_id)
    or exists (
      select 1 from public.itp_items it
        join public.itp_sections s on s.id = it.section_id
        join public.itps i on i.id = s.itp_id
      where it.id = activity_party_intervention.itp_item_id
        and public.is_client_itp_creator(i.project_id, i.status)
    )
  );

drop policy if exists activity_party_intervention_write_i on public.activity_party_intervention;
drop policy if exists activity_party_intervention_write_u on public.activity_party_intervention;
drop policy if exists activity_party_intervention_write_d on public.activity_party_intervention;
create policy activity_party_intervention_write_i on public.activity_party_intervention for insert with check (
  exists (
    select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
    where it.id = activity_party_intervention.itp_item_id
      and ((public.is_jags_staff() and public.itp_item_project_access(it.id)) or public.is_client_itp_creator(i.project_id, i.status))
  )
);
create policy activity_party_intervention_write_u on public.activity_party_intervention for update
  using (
    exists (
      select 1 from public.itp_items it
        join public.itp_sections s on s.id = it.section_id
        join public.itps i on i.id = s.itp_id
      where it.id = activity_party_intervention.itp_item_id
        and ((public.is_jags_staff() and public.itp_item_project_access(it.id)) or public.is_client_itp_creator(i.project_id, i.status))
    )
  )
  with check (
    exists (
      select 1 from public.itp_items it
        join public.itp_sections s on s.id = it.section_id
        join public.itps i on i.id = s.itp_id
      where it.id = activity_party_intervention.itp_item_id
        and ((public.is_jags_staff() and public.itp_item_project_access(it.id)) or public.is_client_itp_creator(i.project_id, i.status))
    )
  );
create policy activity_party_intervention_write_d on public.activity_party_intervention for delete using (
  exists (
    select 1 from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
    where it.id = activity_party_intervention.itp_item_id
      and ((public.is_jags_staff() and public.itp_item_project_access(it.id)) or public.is_client_itp_creator(i.project_id, i.status))
  )
);

-- activity_expected_records: the staff branch had no tenant check at all (is_jags_staff() alone).
do $$
declare
  party_branch text := $b$
    exists (
      select 1
      from public.itp_items it
        join public.itp_sections s on s.id = it.section_id
        join public.itps i on i.id = s.itp_id
        join public.project_parties pp on pp.project_id = i.project_id
      where it.id = activity_expected_records.itp_item_id
        and pp.user_id = (select auth.uid())
        and (
          (activity_expected_records.provider = 'jags' and pp.party_type = 'jags')
          or (activity_expected_records.provider = 'tpi' and pp.party_type = 'tpi_lab')
          or (activity_expected_records.provider = 'contractor' and pp.party_type = any (array['main_contractor', 'subcontractor']))
        )
    )$b$;
  staff_branch text := '(public.is_jags_staff() and public.itp_item_project_access(activity_expected_records.itp_item_id))';
begin
  if to_regclass('public.activity_expected_records') is null then
    return;
  end if;
  execute 'drop policy if exists activity_expected_records_write_i on public.activity_expected_records';
  execute 'drop policy if exists activity_expected_records_write_u on public.activity_expected_records';
  execute 'drop policy if exists activity_expected_records_write_d on public.activity_expected_records';
  execute format('create policy activity_expected_records_write_i on public.activity_expected_records for insert with check (%s or %s)', staff_branch, party_branch);
  execute format('create policy activity_expected_records_write_u on public.activity_expected_records for update using (%s or %s) with check (%s or %s)', staff_branch, party_branch, staff_branch, party_branch);
  execute format('create policy activity_expected_records_write_d on public.activity_expected_records for delete using (%s or %s)', staff_branch, party_branch);
end $$;

-- ===== S2-03: client acceptance tracks the revision =====
alter table public.itps add column if not exists client_accepted_revision int;
update public.itps set client_accepted_revision = revision
  where status = 'client_accepted' and client_accepted_revision is null;

create or replace function public.accept_itp(target_itp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  itp_org uuid;
  itp_project uuid;
  assigned_acceptor uuid;
  is_linked_client boolean;
  acceptor_still_active boolean;
  needs_approval boolean;
begin
  select o.id, p.id, i.assigned_acceptor_user_id, coalesce(i.revision_needs_approval, false)
    into itp_org, itp_project, assigned_acceptor, needs_approval
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

  if needs_approval then
    raise exception 'This ITP has a revision awaiting approval — it can be accepted once that revision is approved';
  end if;

  if assigned_acceptor is not null then
    if auth.uid() != assigned_acceptor then
      raise exception 'Only this ITP''s assigned acceptor can accept it';
    end if;

    select exists (
      select 1 from public.project_parties
      where project_id = itp_project
        and party_type = 'client'
        and user_id = assigned_acceptor
        and is_active
    ) into acceptor_still_active;

    if not acceptor_still_active then
      raise exception 'The assigned acceptor is no longer an active client party on this project — a JAGS Admin must reassign or clear the acceptor before this ITP can be accepted';
    end if;
  else
    select exists (
      select 1 from public.project_parties
      where project_id = itp_project
        and party_type = 'client'
        and user_id = auth.uid()
        and is_active
    ) into is_linked_client;

    if not is_linked_client then
      raise exception 'Only the client party''s own login can accept this ITP';
    end if;
  end if;

  update public.itps
  set status = 'client_accepted', client_accepted_by = auth.uid(), client_accepted_at = now(),
      client_accepted_revision = revision
  where id = target_itp_id and status = 'approved';

  if not found then
    raise exception 'ITP must be approved before it can be accepted';
  end if;
end;
$$;

-- ===== S2-08: controlled exits for an ITP =====
alter table public.itps
  add column if not exists withdrawn_reason text,
  add column if not exists withdrawn_by uuid,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists superseded_by_itp_id uuid references public.itps (id) on delete set null;

alter table public.itps drop constraint if exists itps_status_check;
alter table public.itps
  add constraint itps_status_check
  check (status in ('draft', 'under_review', 'approved', 'client_accepted', 'superseded', 'withdrawn'));

create or replace function public.itps_guard_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status = 'under_review')
      or (old.status = 'under_review' and new.status in ('approved', 'draft'))
      or (old.status = 'approved' and new.status = 'client_accepted')
      -- a content revision that changes what the client accepted sends it back for re-acceptance
      or (old.status = 'client_accepted' and new.status = 'approved')
      -- controlled exits (terminal)
      or (old.status in ('draft', 'under_review', 'approved', 'client_accepted') and new.status in ('superseded', 'withdrawn'))
    ) then
      raise exception 'Illegal ITP status change: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ===== S2-03: no new field inspections against an unapproved revision =====
create or replace function public.inspection_records_block_pending_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending boolean;
  v_number text;
begin
  if public.is_system_caller() then
    return new;
  end if;
  select coalesce(i.revision_needs_approval, false), i.itp_number into v_pending, v_number
  from public.itp_items it
    join public.itp_sections s on s.id = it.section_id
    join public.itps i on i.id = s.itp_id
  where it.id = new.itp_item_id;
  if v_pending then
    raise exception 'ITP % has a revision awaiting approval; inspections can resume once it is approved', v_number using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.inspection_records_block_pending_revision() from public, anon, authenticated;
drop trigger if exists inspection_records_block_pending_revision on public.inspection_records;
create trigger inspection_records_block_pending_revision before insert on public.inspection_records
  for each row execute function public.inspection_records_block_pending_revision();

-- ===== S2-13: keep review rounds =====
create table if not exists public.itp_review_progress_history (
  id uuid primary key default gen_random_uuid(),
  itp_id uuid not null references public.itps (id) on delete cascade,
  review_round int not null,
  reviewer_user_id uuid,
  sort_order int not null default 0,
  status text not null,
  reviewed_at timestamptz,
  archived_reason text,
  archived_at timestamptz not null default now()
);
create index if not exists itp_review_progress_history_itp_idx on public.itp_review_progress_history (itp_id);
alter table public.itp_review_progress_history enable row level security;
drop policy if exists itp_review_progress_history_select on public.itp_review_progress_history;
create policy itp_review_progress_history_select on public.itp_review_progress_history for select using (
  exists (select 1 from public.itps i join public.projects p on p.id = i.project_id
          where i.id = itp_review_progress_history.itp_id and public.has_project_access(p.id, p.organization_id))
);
drop policy if exists itp_review_progress_history_insert on public.itp_review_progress_history;
create policy itp_review_progress_history_insert on public.itp_review_progress_history for insert with check (
  public.is_jags_staff()
  and exists (select 1 from public.itps i join public.projects p on p.id = i.project_id
              where i.id = itp_review_progress_history.itp_id and public.has_project_access(p.id, p.organization_id))
);

-- ===== S2-12: who actually signed a review step =====
alter table public.itp_review_progress add column if not exists signed_by uuid;

-- ===== S2-17 / S2-18 =====
alter table public.itps add column if not exists translations jsonb;
alter table public.itps
  add column if not exists master_template_id uuid references public.itp_master_templates (id) on delete set null,
  add column if not exists master_template_version int;

-- ===== S2-19: sign-off counts in SQL =====
create or replace function public.itp_signoff_counts(target_project_id uuid)
returns table (itp_id uuid, total bigint, signed bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select s.itp_id,
         count(sp.id) as total,
         count(sp.id) filter (where sp.status in ('signed_off', 'proceeded_no_response')) as signed
  from public.itps i
    join public.itp_sections s on s.itp_id = i.id
    join public.itp_items it on it.section_id = s.id
    join public.activity_signoff_progress sp on sp.itp_item_id = it.id
  where i.project_id = target_project_id
  group by s.itp_id;
$$;
revoke all on function public.itp_signoff_counts(uuid) from public, anon;
grant execute on function public.itp_signoff_counts(uuid) to authenticated, service_role;
