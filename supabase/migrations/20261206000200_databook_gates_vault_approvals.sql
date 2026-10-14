-- Audit closeout M1 + H3.
--
-- ROLLBACK NOTE: to undo, re-create data_book_gate_failures() from
--   20261107000100_itp_exit_readiness_and_readonly.sql, re-create vault_documents_guard_approval() from
--   20260930150000_vault_custom_categories_and_multi_approval.sql (+ later edits), restore the three
--   vault_document_approvers policies (insert/delete: is_jags_staff(); update: is_jags_staff() OR own row),
--   and drop: data_book_readiness_counts(uuid), vault_document_approvers_guard_row() + its trigger.
--   No data is changed by this migration. Idempotent.
--
-- (1) M1: data_book_gate_failures() now mirrors the TypeScript readiness
--     (apps/web/lib/databook/readiness.ts, worker/src/jobs/renderDataBookPdf.ts) exactly:
--     project Completed, zero open punch items, and every one of the 11 gating categories at 100%
--     (percentage = round(ready*100/total), 100 when total = 0, same as toCategory()).
--     compile_data_book / issue_data_book_handover are unchanged; they already call the gate function and
--     keep their override path (p_override + admin + reason).
--     Registers count only verified + active rows; expiry is judged against today's UTC date.
-- (2) H3: a vault document with named approvers (vault_document_approvers) can only move to 'approved'
--     (by a signed-in user) when the caller is one of the named approvers and EVERY approver row is
--     'approved' (mirrors approveDocumentAction). Admins/permission holders cannot approve around the list.
--     Approver rows can only be changed by the approver themself (status/reviewed_at); only admin staff
--     can add/remove approvers (setDocumentApproversAction is admin-only). Applies on transitions only.
--     NOT added: "uploader cannot approve own document" - the app does not enforce it (live data has such
--     approvals), so it is intentionally left alone.

-- ---------------------------------------------------------------------------------------------------
-- Readiness counts (one row per gating category). Internal helper: not callable by API roles.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.data_book_readiness_counts(p_project_id uuid, p_as_of date default null)
returns table (category text, label text, ready int, total int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := coalesce(p_as_of, (now() at time zone 'utc')::date);
  v_ready int;
  v_total int;
  v_lkey uuid[] := '{}'; v_lid uuid[] := '{}'; v_lres text[] := '{}';
  v_all_items uuid[]; v_ev1_items uuid[];
begin
  -- 1. ITPs approved or client-accepted (superseded/withdrawn ignored; re-approval pending is not ready)
  select count(*), count(*) filter (where status in ('approved', 'client_accepted') and not coalesce(revision_needs_approval, false))
    into v_total, v_ready
    from public.itps where project_id = p_project_id and status not in ('superseded', 'withdrawn');
  category := 'itps'; label := 'ITPs approved or client-accepted'; ready := v_ready; total := v_total; return next;

  -- latest COMPLETED record per itp_item (ties: first by id), as the TS latestByItem map; items of issued
  -- (approved / client_accepted) ITPs. Kept as arrays (no temp tables: this function is STABLE).
  select array_agg(distinct_rows.key), array_agg(distinct_rows.id), array_agg(distinct_rows.overall_result)
    into v_lkey, v_lid, v_lres
    from (select distinct on (coalesce(r.itp_item_id, r.id)) coalesce(r.itp_item_id, r.id) as key, r.id, r.overall_result
            from public.inspection_records r
           where r.project_id = p_project_id and r.overall_result is not null and r.overall_result <> ''
           order by coalesce(r.itp_item_id, r.id), r.created_at desc, r.id) distinct_rows;
  select coalesce(array_agg(it.id), '{}'), coalesce(array_agg(it.id) filter (where it.evidence_type = 1), '{}')
    into v_all_items, v_ev1_items
    from public.itps p
    join public.itp_sections s on s.itp_id = p.id
    join public.itp_items it on it.section_id = s.id
   where p.project_id = p_project_id and p.status in ('approved', 'client_accepted');

  -- 2. Inspection records with an (unvoided) IRN: latest completed pass/partial per item
  select count(*), count(*) filter (where exists (select 1 from public.irns i where i.inspection_record_id = l.id and i.voided_at is null))
    into v_total, v_ready
    from unnest(v_lid, v_lres) as l(id, res) where l.res in ('pass', 'partial');
  category := 'inspection_records'; label := 'Inspection records with an issued IRN'; ready := v_ready; total := v_total; return next;

  -- 3. Completed checklists: templates on evidence_type = 1 items that have a completed inspection record
  select count(*), count(*) filter (where exists (
           select 1 from public.inspection_records r
            where r.project_id = p_project_id and r.checklist_template_id = t.id and r.overall_result is not null))
    into v_total, v_ready
    from public.checklist_templates t
   where t.itp_item_id = any (v_ev1_items);
  category := 'checklists'; label := 'Completed checklists'; ready := v_ready; total := v_total; return next;

  -- 4. Calibration (verified + active rows; expired = due_date before today)
  select count(*), count(*) filter (where due_date >= v_today) into v_total, v_ready
    from public.calibration_register
   where project_id = p_project_id and verified_at is not null and coalesce(lifecycle_status, 'active') = 'active';
  category := 'calibration'; label := 'Calibration certificates in date'; ready := v_ready; total := v_total; return next;

  -- 5. Welder qualifications
  select count(*), count(*) filter (where expiry_date >= v_today) into v_total, v_ready
    from public.welder_qualification_register
   where project_id = p_project_id and verified_at is not null and coalesce(lifecycle_status, 'active') = 'active';
  category := 'welder'; label := 'Welder qualifications valid'; ready := v_ready; total := v_total; return next;

  -- 6. Personnel certifications
  select count(*), count(*) filter (where expiry_date >= v_today) into v_total, v_ready
    from public.personnel_certifications
   where project_id = p_project_id and verified_at is not null and coalesce(lifecycle_status, 'active') = 'active';
  category := 'personnel'; label := 'Personnel certifications valid'; ready := v_ready; total := v_total; return next;

  -- 7. Material traceability: approved (A/B) and released
  select count(*), count(*) filter (where approval_status in ('A', 'B') and receipt_status = 'released') into v_total, v_ready
    from public.material_register
   where project_id = p_project_id and verified_at is not null and coalesce(lifecycle_status, 'active') = 'active';
  category := 'material'; label := 'Materials approved and released'; ready := v_ready; total := v_total; return next;

  -- 8. Standalone assignments cleared
  select count(*), count(*) filter (where status = 'completed' and (conclusion = 'pass' or (conclusion = 'conditional_pass' and cleared_at is not null)))
    into v_total, v_ready
    from public.standalone_assignments where project_id = p_project_id;
  category := 'standalone'; label := 'Standalone assignments cleared'; ready := v_ready; total := v_total; return next;

  -- 9. NCRs closed (observations are advisory, excluded; null severity counts)
  select count(*), count(*) filter (where status = 'closed') into v_total, v_ready
    from public.ncrs where project_id = p_project_id and coalesce(severity, '') <> 'observation';
  category := 'ncrs'; label := 'NCRs closed'; ready := v_ready; total := v_total; return next;

  -- 10. ITP activities (evidence_type = 1) whose latest completed inspection passed
  select count(*), count(*) filter (where exists (
           select 1 from unnest(v_lkey, v_lres) as l(k, res) where l.k = i.id and l.res in ('pass', 'partial')))
    into v_total, v_ready
    from unnest(v_ev1_items) as i(id);
  category := 'activities'; label := 'ITP activities inspected and passed'; ready := v_ready; total := v_total; return next;

  -- 11. Hold and Witness points signed off (Witness may also be proceeded after notice)
  select count(*), count(*) filter (where h.status = 'signed_off' or (h.intervention = 'W' and h.status = 'proceeded_no_response'))
    into v_total, v_ready
    from public.activity_signoff_progress h
   where h.intervention in ('H', 'W') and h.itp_item_id = any (v_all_items);
  category := 'hold_points'; label := 'Hold and witness points signed off'; ready := v_ready; total := v_total; return next;
end;
$$;
revoke all on function public.data_book_readiness_counts(uuid, date) from public, anon, authenticated;
grant execute on function public.data_book_readiness_counts(uuid, date) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Gate function: same signature/return as before (text[] of failures; empty = ready).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.data_book_gate_failures(p_project_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out text[] := '{}';
  v_n int;
  v_status text;
  r record;
begin
  select status into v_status from public.projects where id = p_project_id;
  if v_status is distinct from 'completed' then
    v_out := v_out || ('project status is ' || coalesce(v_status, 'unknown') || ', not completed');
  end if;
  select count(*) into v_n from public.punch_list_items where project_id = p_project_id and status <> 'closed';
  if v_n > 0 then v_out := v_out || (v_n || ' open punch item(s)'); end if;

  -- A category gates the book when its percentage (round(ready*100/total), 100 if total = 0) is below 100.
  for r in select * from public.data_book_readiness_counts(p_project_id) loop
    if r.total > 0 and round(r.ready::numeric * 100 / r.total) < 100 then
      v_out := v_out || (
        case r.category
          when 'ncrs' then (r.total - r.ready) || ' open NCR(s)'
          when 'itps' then (r.total - r.ready) || ' ITP(s) not approved'
          else r.label || ': ' || (r.total - r.ready) || ' of ' || r.total || ' outstanding'
        end);
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.data_book_gate_failures(uuid) from public, anon;
grant execute on function public.data_book_gate_failures(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- H3: vault multi-approver enforcement
-- ---------------------------------------------------------------------------------------------------
create or replace function public.vault_documents_guard_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_project_id uuid;
begin
  if auth.uid() is null then return new; end if;
  if (new.status in ('approved', 'rejected') and old.status is distinct from new.status)
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at
     or new.rejected_by is distinct from old.rejected_by
     or new.rejected_at is distinct from old.rejected_at then
    select f.project_id into v_project_id from public.vault_folders f where f.id = new.folder_id;
    if not (
      public.is_admin_staff()
      or public.has_custom_permission(auth.uid(), 'approve_vault_document', v_project_id)
      or exists (select 1 from public.vault_document_approvers a where a.document_id = new.id and a.approver_user_id = auth.uid())
    ) then
      raise exception 'Only a JAGS Admin, a named approver or someone granted the approve permission can approve or reject a vault document' using errcode = '42501';
    end if;
  end if;

  -- Named approvers: the document only becomes approved once every one of them has approved, and only a
  -- named approver completes it (approveDocumentAction). Transition-only: existing approved rows are untouched.
  if new.status = 'approved' and old.status is distinct from 'approved'
     and exists (select 1 from public.vault_document_approvers a where a.document_id = new.id) then
    if not exists (select 1 from public.vault_document_approvers a where a.document_id = new.id and a.approver_user_id = auth.uid()) then
      raise exception 'This document requires specific named approvers; only a named approver can complete its approval' using errcode = '42501';
    end if;
    if exists (select 1 from public.vault_document_approvers a where a.document_id = new.id and a.status is distinct from 'approved') then
      raise exception 'Every named approver must approve before this document is approved' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Approver rows: only the approver can set their own row; admin staff manage membership.
drop policy if exists vault_document_approvers_update on public.vault_document_approvers;
create policy vault_document_approvers_update on public.vault_document_approvers
  for update using (approver_user_id = (select auth.uid()))
  with check (approver_user_id = (select auth.uid()));

drop policy if exists vault_document_approvers_insert on public.vault_document_approvers;
create policy vault_document_approvers_insert on public.vault_document_approvers
  for insert with check (
    public.is_admin_staff() and exists (
      select 1 from public.vault_documents d
        join public.vault_folders f on f.id = d.folder_id
        join public.projects p on p.id = f.project_id
       where d.id = vault_document_approvers.document_id and public.has_org_access(p.organization_id)));

drop policy if exists vault_document_approvers_delete on public.vault_document_approvers;
create policy vault_document_approvers_delete on public.vault_document_approvers
  for delete using (public.is_admin_staff());

-- An approver may only change status / reviewed_at on their own row (never move it to another document or user).
create or replace function public.vault_document_approvers_guard_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if new.document_id is distinct from old.document_id
     or new.approver_user_id is distinct from old.approver_user_id then
    raise exception 'An approver row cannot be moved to another document or person' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.vault_document_approvers_guard_row() from public, anon, authenticated;

drop trigger if exists vault_document_approvers_guard_row on public.vault_document_approvers;
create trigger vault_document_approvers_guard_row before update on public.vault_document_approvers
  for each row execute function public.vault_document_approvers_guard_row();
