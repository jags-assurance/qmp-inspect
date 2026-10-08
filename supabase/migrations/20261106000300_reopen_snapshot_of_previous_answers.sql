-- PHASE 3: re-open keeps a snapshot of the previous answers and signatures. Idempotent, additive.
-- inspection_record_amendments stays insert-only; these are just more columns on the same row.

alter table public.inspection_record_amendments add column if not exists previous_responses jsonb;
alter table public.inspection_record_amendments add column if not exists previous_inspector_signature text;
alter table public.inspection_record_amendments add column if not exists previous_witness_name text;
alter table public.inspection_record_amendments add column if not exists previous_witness_signature text;
alter table public.inspection_record_amendments add column if not exists previous_review_status text;

-- Same body as 20261101000300 plus: the snapshot columns above, and the review decision is cleared
-- (a re-opened inspection must be reviewed again). SECURITY INVOKER as before. When review_status
-- does not exist yet (20261106000200 not applied) the function still works.
create or replace function public.reopen_inspection(p_record_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rec public.inspection_records%rowtype;
  v_irn_id uuid;
  v_irn_number text;
  v_n int;
  v_docs int := 0;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_responses jsonb;
  v_review text;
  v_has_review boolean;
begin
  if length(v_reason) < 15 then
    raise exception 'Give a reason for re-opening (at least 15 characters)';
  end if;

  select * into v_rec from public.inspection_records where id = p_record_id for update;
  if not found then
    raise exception 'Inspection record not found';
  end if;
  if v_rec.overall_result is null then
    raise exception 'This inspection is not completed, so there is nothing to re-open';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'checklist_item_id', r.checklist_item_id,
           'item_number', i.item_number,
           'description', i.description,
           'result', r.result,
           'comment', r.comment
         ) order by i.sort_order), '[]'::jsonb)
    into v_responses
    from public.checklist_responses r
    left join public.checklist_items i on i.id = r.checklist_item_id
   where r.inspection_record_id = p_record_id;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inspection_records' and column_name = 'review_status')
    into v_has_review;
  if v_has_review then
    v_review := to_jsonb(v_rec) ->> 'review_status';
  end if;

  insert into public.inspection_record_amendments (
    record_id, amended_by, reason, previous_overall_result, previous_signed_by_name, previous_signed_at, previous_notes,
    previous_responses, previous_inspector_signature, previous_witness_name, previous_witness_signature, previous_review_status
  ) values (
    p_record_id, auth.uid(), v_reason, v_rec.overall_result, v_rec.signed_by_name, v_rec.signed_at, v_rec.notes,
    v_responses, v_rec.inspector_signature, v_rec.witness_name, v_rec.witness_signature, v_review
  );

  update public.inspection_records
     set overall_result = null, inspector_signature = null, signed_by_name = null, signed_at = null,
         witness_name = null, witness_signature = null
   where id = p_record_id and overall_result is not null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'This inspection was already re-opened';
  end if;

  if v_has_review then
    execute 'update public.inspection_records set review_status = null, reviewed_by = null, reviewed_at = null, review_comment = null where id = $1'
      using p_record_id;
  end if;

  select i.id, i.irn_number into v_irn_id, v_irn_number
    from public.irns i
   where i.inspection_record_id = p_record_id and i.voided_at is null
   limit 1 for update;
  if found then
    update public.irns
       set voided_at = now(), voided_by = auth.uid(), void_reason = 'Inspection re-opened: ' || v_reason
     where id = v_irn_id and voided_at is null;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'The live IRN could not be voided, so the inspection was not re-opened';
    end if;
  end if;

  update public.vault_documents d
     set status = 'superseded'
   where d.status = 'approved'
     and d.document_reference in (v_rec.record_number, coalesce(v_irn_number, v_rec.record_number))
     and d.folder_id in (select f.id from public.vault_folders f where f.project_id = v_rec.project_id);
  get diagnostics v_docs = row_count;

  return jsonb_build_object('voided_irn', v_irn_number, 'superseded_documents', v_docs);
end;
$$;
revoke all on function public.reopen_inspection(uuid, text) from public, anon;
grant execute on function public.reopen_inspection(uuid, text) to authenticated, service_role;
