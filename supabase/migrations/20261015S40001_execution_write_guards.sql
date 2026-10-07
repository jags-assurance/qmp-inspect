-- Execution write guards (DB-layer mirror of the app rules).
--
-- RLS on inspection_records / checklist_responses / inspection_evidence_documents only checks
-- tenant/project access, so a crafted client request could edit or delete a completed (signed)
-- inspection. These triggers enforce what the app already does:
--   * once inspection_records.overall_result is not null the record, its checklist responses and
--     its evidence-document links are frozen;
--   * the only ways through are the re-open path (lifecycle-actions.ts reopenInspectionAction:
--     UPDATE ... SET overall_result = NULL by JAGS staff, admin or project team lead), a staff-only
--     narrative edit (saveInspectionNarrativeAction), cascade deletes from a parent (project/ITP
--     deletion, trigger depth > 1) and service_role / postgres (worker, migrations);
--   * activity_signoff_progress can only become 'signed_off' by JAGS staff or by the active
--     project party's own linked login (mirrors canSignOffForParty in lib/signoff/actions.ts).
-- Also adds inspection_records.signed_by_user_id (already written by completeInspectionAction and
-- present in packages/shared-types, but not created by any earlier migration).
-- Idempotent.

-- ===== 0. Helpers =====

-- True for the Supabase service role (worker) and direct postgres/supabase_admin sessions
-- (migrations, SQL editor). Uses session_user, not current_user, because the guard functions are
-- SECURITY DEFINER (current_user would always be the function owner).
create or replace function public.is_system_caller()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and session_user in ('postgres', 'supabase_admin', 'service_role'));
$$;

revoke all on function public.is_system_caller() from public, anon;
grant execute on function public.is_system_caller() to authenticated, service_role;

create or replace function public.inspection_record_is_completed(target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.inspection_records r
    where r.id = target_record_id and r.overall_result is not null
  );
$$;

revoke all on function public.inspection_record_is_completed(uuid) from public, anon;
grant execute on function public.inspection_record_is_completed(uuid) to authenticated, service_role;

-- ===== 1. signed_by_user_id =====

alter table public.inspection_records
  add column if not exists signed_by_user_id uuid references public.users (id);

create index if not exists inspection_records_signed_by_user_id_idx
  on public.inspection_records (signed_by_user_id);

-- ===== 2. inspection_records: freeze once completed =====

create or replace function public.inspection_records_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Cascade from a parent delete (project / ITP): leave to the parent's own rules.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if public.is_system_caller() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.overall_result is not null then
      raise exception 'A completed inspection cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.overall_result is null then
    return new; -- open draft: normal editing / completion
  end if;

  -- Re-open (amend) path: result cleared. Same population as the app's re-open check
  -- (admin staff or a team lead; both are JAGS staff, the app does the finer check).
  if new.overall_result is null then
    if public.is_jags_staff() then
      return new;
    end if;
    raise exception 'Only JAGS staff can re-open a completed inspection' using errcode = '42501';
  end if;

  -- Narrative-only edit on a completed record (staff report narrative).
  if public.is_jags_staff()
     and (to_jsonb(new) - 'narrative' - 'updated_at') = (to_jsonb(old) - 'narrative' - 'updated_at') then
    return new;
  end if;

  raise exception 'Inspection is completed; it can only be changed by re-opening it' using errcode = '42501';
end;
$$;

revoke all on function public.inspection_records_write_guard() from public, anon;

drop trigger if exists inspection_records_write_guard on public.inspection_records;
create trigger inspection_records_write_guard
  before update or delete on public.inspection_records
  for each row execute function public.inspection_records_write_guard();

-- Direct deletes: the app never deletes inspection records. Keep a narrow path for JAGS staff to
-- discard an open draft; completed records are additionally blocked by the trigger above.
drop policy if exists inspection_records_write_d on public.inspection_records;
create policy inspection_records_write_d on public.inspection_records
  for delete using (
    overall_result is null
    and public.is_jags_staff()
    and exists (
      select 1 from public.projects p
      where p.id = inspection_records.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );

-- ===== 3. child tables: checklist_responses, inspection_evidence_documents =====

create or replace function public.inspection_child_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old); -- cascade from the record / checklist item / vault document
  end if;
  if public.is_system_caller() then
    return coalesce(new, old);
  end if;

  if tg_op in ('UPDATE', 'DELETE') and public.inspection_record_is_completed(old.inspection_record_id) then
    raise exception 'Inspection is completed; % can no longer be changed', tg_table_name using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.inspection_record_is_completed(new.inspection_record_id) then
    raise exception 'Inspection is completed; % can no longer be changed', tg_table_name using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.inspection_child_write_guard() from public, anon;

drop trigger if exists checklist_responses_write_guard on public.checklist_responses;
create trigger checklist_responses_write_guard
  before insert or update or delete on public.checklist_responses
  for each row execute function public.inspection_child_write_guard();

drop trigger if exists inspection_evidence_documents_write_guard on public.inspection_evidence_documents;
create trigger inspection_evidence_documents_write_guard
  before insert or update or delete on public.inspection_evidence_documents
  for each row execute function public.inspection_child_write_guard();

-- ===== 4. activity_signoff_progress: who may mark signed_off =====

create or replace function public.activity_signoff_progress_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'signed_off' and (tg_op = 'INSERT' or old.status is distinct from 'signed_off') then
    if public.is_system_caller() or public.is_jags_staff() then
      return new;
    end if;
    if exists (
      select 1 from public.project_parties pp
      where pp.id = new.project_party_id
        and pp.user_id = auth.uid()
        and pp.is_active
    ) then
      return new;
    end if;
    raise exception 'Only the linked party (or JAGS staff) can sign off this activity' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.activity_signoff_progress_guard() from public, anon;

drop trigger if exists activity_signoff_progress_guard on public.activity_signoff_progress;
create trigger activity_signoff_progress_guard
  before insert or update on public.activity_signoff_progress
  for each row execute function public.activity_signoff_progress_guard();
