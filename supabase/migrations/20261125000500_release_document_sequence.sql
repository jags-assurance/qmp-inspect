-- B3: next_document_sequence() advances the counter before the document row is inserted, so a failed
-- insert used to leave a gap in the numbering. release_document_sequence() hands the number back: it
-- steps the counter down by one, but ONLY while the counter still equals the number being released
-- (compare-and-decrement, atomic via the row lock of the UPDATE). If another number was allocated in the
-- meantime the counter has moved on and nothing is changed (that gap cannot be closed without
-- renumbering issued documents, which is deliberately never done). It only ever moves a counter back to a
-- value it held a moment ago; no document row or number is touched. Same authorisation as
-- next_document_sequence. Idempotent.
create or replace function public.release_document_sequence(org_id uuid, proj_id uuid, seq_doc_type text, released_value integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rows int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_org_access(org_id) then
    raise exception 'Not authorized for this organisation';
  end if;
  if released_value is null or released_value < 1 then
    return false;
  end if;

  if proj_id is null then
    update public.document_sequences
       set current_number = current_number - 1, updated_at = now()
     where organization_id = org_id and project_id is null and doc_type = seq_doc_type
       and current_number = released_value;
  else
    update public.document_sequences
       set current_number = current_number - 1, updated_at = now()
     where organization_id = org_id and project_id = proj_id and doc_type = seq_doc_type
       and current_number = released_value;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

revoke execute on function public.release_document_sequence(uuid, uuid, text, integer) from public, anon;
grant execute on function public.release_document_sequence(uuid, uuid, text, integer) to authenticated, service_role;
