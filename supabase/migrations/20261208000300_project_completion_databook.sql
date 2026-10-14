-- M9: project completion vs Data Book circularity.
-- Before: projects_status_guard refused completion while ANY data book was not issued, but
-- compile_data_book / data_book_gate_failures require the project to be 'completed' first (a clean
-- book cannot be compiled or issued before completion). Draft/compiled books therefore deadlocked closing.
-- After: draft and compiled books no longer block completion (nothing has gone to the client yet), so the
-- working order is: complete project -> compile -> issue -> client acknowledges. A project that has an
-- ISSUED handover still awaiting the client's acknowledgement (not acknowledged, rejected or superseded)
-- cannot be completed/re-closed without the documented close_project() override.
-- Idempotent (create or replace). Rollback: re-apply projects_status_guard from 20261104000600.
create or replace function public.projects_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ncr int;
  v_punch int;
  v_draft int;
  v_book int := 0;
  v_rev int := 0;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  if old.status in ('completed', 'cancelled') and not public.is_admin_staff() then
    raise exception 'Only admin staff can reopen a completed or cancelled project';
  end if;

  if new.status = 'completed'
     and coalesce(current_setting('app.close_override', true), '') <> '1' then
    select count(*) into v_ncr from public.ncrs
      where project_id = new.id and status <> 'closed' and coalesce(severity, '') <> 'observation';
    select count(*) into v_punch from public.punch_list_items
      where project_id = new.id and status <> 'closed';
    select count(*) into v_draft from public.inspection_records
      where project_id = new.id and overall_result is null;
    if to_regclass('public.handover_certificates') is not null then
      select count(*) into v_book
      from public.handover_certificates c
      join public.data_books b on b.id = c.data_book_id
      where b.project_id = new.id
        and c.acknowledged_at is null and c.rejected_at is null and c.superseded_at is null;
    end if;
    select count(*) into v_rev from public.itps
      where project_id = new.id and revision_needs_approval;
    if v_ncr > 0 or v_punch > 0 or v_draft > 0 or v_book > 0 or v_rev > 0 then
      raise exception 'Cannot complete project: % open NCR(s), % open punch item(s), % draft inspection(s), % issued handover(s) awaiting client acknowledgement, % ITP revision(s) awaiting approval. Use close_project() with a reason (5+ characters) to override.',
        v_ncr, v_punch, v_draft, v_book, v_rev;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.projects_status_guard() from public, anon, authenticated;
