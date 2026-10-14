-- Audit fixes site-execution H1 + H2.
--  H1: discard_inspection_draft(record_id, reason): lets the people who can execute an activity (or the
--      inspector who started the draft, or JAGS staff) remove an abandoned DRAFT inspection. RLS only lets
--      JAGS staff delete drafts, so a party user needs this SECURITY DEFINER route. Responses, photos rows,
--      evidence links, comments, history cascade by FK; the function returns the photo storage paths so the
--      app can remove the files. Completed inspections are refused; so are drafts referenced by an NCR or
--      punch item (those FKs do not cascade).
--  H2: irns_issue_gates_guard now also refuses a NEW IRN while the inspection's review_status = 'rejected'.
--      Existing IRNs are untouched (insert-only rule). Cleared by a fresh approve, or by re-opening.
-- Idempotent (create or replace). Rollback: drop function public.discard_inspection_draft(uuid, text);
-- and re-create irns_issue_gates_guard from 20261205000100 (without the review_status block).

create or replace function public.discard_inspection_draft(p_record_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rec public.inspection_records%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_paths text[];
begin
  if auth.uid() is null then
    raise exception 'Sign in to discard a draft inspection' using errcode = '42501';
  end if;
  if length(v_reason) < 5 then
    raise exception 'Give a short reason for discarding the draft (at least 5 characters)' using errcode = '22023';
  end if;

  select * into v_rec from public.inspection_records where id = p_record_id for update;
  if not found then
    raise exception 'Inspection record not found' using errcode = 'P0002';
  end if;
  if v_rec.overall_result is not null then
    raise exception 'A completed inspection cannot be discarded; re-open it instead' using errcode = '42501';
  end if;
  if not (public.can_execute_itp_item(v_rec.itp_item_id) or v_rec.inspector_id = auth.uid()) then
    raise exception 'Only JAGS staff, the party assigned to this activity, or the inspector who started it can discard this draft' using errcode = '42501';
  end if;
  if not public.project_is_writable(v_rec.project_id) then
    raise exception 'This project is completed or cancelled; changes are not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.ncrs where inspection_record_id = p_record_id)
     or exists (select 1 from public.punch_list_items where source_inspection_record_id = p_record_id) then
    raise exception 'An NCR or punch item was raised from this draft, so it cannot be discarded' using errcode = '23503';
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_paths
    from public.inspection_photos where inspection_record_id = p_record_id;

  delete from public.inspection_records where id = p_record_id and overall_result is null;

  return jsonb_build_object(
    'record_number', v_rec.record_number,
    'project_id', v_rec.project_id,
    'itp_item_id', v_rec.itp_item_id,
    'photo_paths', to_jsonb(v_paths)
  );
end;
$$;

revoke all on function public.discard_inspection_draft(uuid, text) from public, anon;
grant execute on function public.discard_inspection_draft(uuid, text) to authenticated;

create or replace function public.irns_issue_gates_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() then
    return new;
  end if;

  select id, itp_item_id, overall_result, checklist_template_id, review_status into r
    from public.inspection_records where id = new.inspection_record_id;
  if not found then
    return new;
  end if;

  if r.review_status = 'rejected' then
    raise exception 'This inspection was rejected on review; correct it and have it re-reviewed (or re-open it) before issuing an IRN' using errcode = '42501';
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
