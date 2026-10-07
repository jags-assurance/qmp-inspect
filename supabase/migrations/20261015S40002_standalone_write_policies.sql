-- Standalone assignments: DB-layer mirror of lib/standalone/actions.ts canRunStandaloneAssignment
-- and the draft / conditional_open / completed lifecycle.
--
-- Until now every standalone_assignment* write policy checked has_project_access() alone, so any
-- project viewer (e.g. a client reviewer) could write through the API even though the app limits
-- running an assignment to JAGS staff, holders of run_standalone_assignment, and (when the project
-- toggle is on) active subcontractor / main-contractor parties.
-- Idempotent.

-- ===== 1. Permission helper (exact mirror of canRunStandaloneAssignment) =====

create or replace function public.can_run_standalone_assignment(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_jags_staff()
    or public.has_custom_permission(auth.uid(), 'run_standalone_assignment', target_project_id)
    or exists (
      select 1
      from public.projects p
      join public.project_parties pp on pp.project_id = p.id
      where p.id = target_project_id
        and p.allow_contractor_standalone_assignment
        and pp.user_id = auth.uid()
        and pp.is_active
        and pp.party_type in ('subcontractor', 'main_contractor')
    );
$$;

revoke all on function public.can_run_standalone_assignment(uuid) from public, anon;
grant execute on function public.can_run_standalone_assignment(uuid) to authenticated, service_role;

-- ===== 2. Parent table policies =====

drop policy if exists standalone_assignments_write on public.standalone_assignments;
drop policy if exists standalone_assignments_write_i on public.standalone_assignments;
drop policy if exists standalone_assignments_write_u on public.standalone_assignments;
drop policy if exists standalone_assignments_write_d on public.standalone_assignments;

create policy standalone_assignments_write_i on public.standalone_assignments
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
    and public.can_run_standalone_assignment(standalone_assignments.project_id)
  );

create policy standalone_assignments_write_u on public.standalone_assignments
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
    and public.can_run_standalone_assignment(standalone_assignments.project_id)
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
    and public.can_run_standalone_assignment(standalone_assignments.project_id)
  );

create policy standalone_assignments_write_d on public.standalone_assignments
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = standalone_assignments.project_id
        and public.has_project_access(p.id, p.organization_id)
    )
    and public.can_run_standalone_assignment(standalone_assignments.project_id)
  );

-- ===== 3. Child table policies (same rule via the parent assignment) =====
-- evidence_documents has never had an UPDATE policy (links are insert/delete only): keep that.

do $$
declare
  child text;
  ops text[];
  op text;
  suffix text;
begin
  foreach child in array array[
    'standalone_assignment_measurements',
    'standalone_assignment_photos',
    'standalone_assignment_punch_items',
    'standalone_assignment_signatures',
    'standalone_assignment_evidence_documents'
  ] loop
    execute format('drop policy if exists %I on public.%I', child || '_write', child);
    execute format('drop policy if exists %I on public.%I', child || '_write_i', child);
    execute format('drop policy if exists %I on public.%I', child || '_write_u', child);
    execute format('drop policy if exists %I on public.%I', child || '_write_d', child);

    ops := case when child = 'standalone_assignment_evidence_documents'
                then array['insert', 'delete']
                else array['insert', 'update', 'delete'] end;

    foreach op in array ops loop
      suffix := case op when 'insert' then 'i' when 'update' then 'u' else 'd' end;
      if op = 'insert' then
        execute format(
          'create policy %I on public.%I for insert with check (
             exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
                     where a.id = %I.assignment_id
                       and public.has_project_access(p.id, p.organization_id)
                       and public.can_run_standalone_assignment(a.project_id)))',
          child || '_write_' || suffix, child, child);
      elsif op = 'update' then
        execute format(
          'create policy %I on public.%I for update using (
             exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
                     where a.id = %I.assignment_id
                       and public.has_project_access(p.id, p.organization_id)
                       and public.can_run_standalone_assignment(a.project_id)))
           with check (
             exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
                     where a.id = %I.assignment_id
                       and public.has_project_access(p.id, p.organization_id)
                       and public.can_run_standalone_assignment(a.project_id)))',
          child || '_write_' || suffix, child, child, child);
      else
        execute format(
          'create policy %I on public.%I for delete using (
             exists (select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
                     where a.id = %I.assignment_id
                       and public.has_project_access(p.id, p.organization_id)
                       and public.can_run_standalone_assignment(a.project_id)))',
          child || '_write_' || suffix, child, child);
      end if;
    end loop;
  end loop;
end;
$$;

-- ===== 4. Lifecycle trigger on the parent =====
-- Allowed status moves (mirrors lib/standalone/actions.ts):
--   draft -> completed | conditional_open        (finalize)
--   conditional_open -> completed                (issue clearance)
--   conditional_open -> draft                    (finalize rollback when the linked punch item fails)
--   completed -> draft                           (admin staff "reopen with reason" only)
-- conclusion may only change together with one of those moves. A completed assignment is otherwise
-- frozen, except a JAGS-staff narrative-only edit (report narrative).

create or replace function public.standalone_assignments_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- UPDATE
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
$$;

revoke all on function public.standalone_assignments_lifecycle_guard() from public, anon;

drop trigger if exists standalone_assignments_lifecycle_guard on public.standalone_assignments;
create trigger standalone_assignments_lifecycle_guard
  before insert or update or delete on public.standalone_assignments
  for each row execute function public.standalone_assignments_lifecycle_guard();

-- ===== 5. Child rows only while the parent is open =====
-- tg_argv[0] = comma list of parent statuses that allow writes.
--   measurements, signatures        : draft
--   punch items, photos, evidence   : draft, conditional_open

create or replace function public.standalone_child_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed text[] := string_to_array(tg_argv[0], ',');
  parent_status text;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return coalesce(new, old); -- cascade from parent delete, worker, migrations
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select status into parent_status from public.standalone_assignments where id = old.assignment_id;
    if parent_status is not null and not (parent_status = any (allowed)) then
      raise exception 'This assignment is % and locked; % can no longer be changed', parent_status, tg_table_name using errcode = '42501';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select status into parent_status from public.standalone_assignments where id = new.assignment_id;
    if parent_status is not null and not (parent_status = any (allowed)) then
      raise exception 'This assignment is % and locked; % can no longer be changed', parent_status, tg_table_name using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.standalone_child_write_guard() from public, anon;

drop trigger if exists standalone_assignment_measurements_write_guard on public.standalone_assignment_measurements;
create trigger standalone_assignment_measurements_write_guard
  before insert or update or delete on public.standalone_assignment_measurements
  for each row execute function public.standalone_child_write_guard('draft');

drop trigger if exists standalone_assignment_signatures_write_guard on public.standalone_assignment_signatures;
create trigger standalone_assignment_signatures_write_guard
  before insert or update or delete on public.standalone_assignment_signatures
  for each row execute function public.standalone_child_write_guard('draft');

drop trigger if exists standalone_assignment_punch_items_write_guard on public.standalone_assignment_punch_items;
create trigger standalone_assignment_punch_items_write_guard
  before insert or update or delete on public.standalone_assignment_punch_items
  for each row execute function public.standalone_child_write_guard('draft,conditional_open');

drop trigger if exists standalone_assignment_photos_write_guard on public.standalone_assignment_photos;
create trigger standalone_assignment_photos_write_guard
  before insert or update or delete on public.standalone_assignment_photos
  for each row execute function public.standalone_child_write_guard('draft,conditional_open');

drop trigger if exists standalone_assignment_evidence_documents_write_guard on public.standalone_assignment_evidence_documents;
create trigger standalone_assignment_evidence_documents_write_guard
  before insert or update or delete on public.standalone_assignment_evidence_documents
  for each row execute function public.standalone_child_write_guard('draft,conditional_open');

-- ===== 6. Storage: contractor branch for standalone/{assignment}/ uploads =====
-- Same project-path branch as before; the standalone branch now uses the shared permission helper
-- (staff, run_standalone_assignment, or toggle-enabled contractor party).

drop policy if exists inspection_evidence_insert on storage.objects;
create policy inspection_evidence_insert on storage.objects for insert with check (
  bucket_id = 'inspection-evidence'
  and (
    exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[1]
        and has_org_access(p.organization_id)
    )
    or exists (
      select 1 from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where (storage.foldername(objects.name))[1] = 'standalone'
        and a.id::text = (storage.foldername(objects.name))[2]
        and has_org_access(p.organization_id)
        and public.can_run_standalone_assignment(a.project_id)
    )
  )
);
