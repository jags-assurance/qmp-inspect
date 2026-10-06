-- next_document_sequence was SECURITY DEFINER with no authorisation: any caller could bump any org counter.
-- Require org access for signed-in callers (service role / worker still allowed).
create or replace function public.next_document_sequence(org_id uuid, proj_id uuid, seq_doc_type text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  next_value int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_org_access(org_id) then
    raise exception 'Not authorized for this organisation';
  end if;

  if proj_id is null then
    insert into public.document_sequences (organization_id, project_id, doc_type, current_number)
    values (org_id, null, seq_doc_type, 1)
    on conflict (organization_id, doc_type) where project_id is null
    do update set current_number = document_sequences.current_number + 1,
                  updated_at = now()
    returning current_number into next_value;
  else
    insert into public.document_sequences (organization_id, project_id, doc_type, current_number)
    values (org_id, proj_id, seq_doc_type, 1)
    on conflict (organization_id, project_id, doc_type) where project_id is not null
    do update set current_number = document_sequences.current_number + 1,
                  updated_at = now()
    returning current_number into next_value;
  end if;

  return next_value;
end;
$function$;

revoke execute on function public.next_document_sequence(uuid, uuid, text) from public, anon;
grant execute on function public.next_document_sequence(uuid, uuid, text) to authenticated, service_role;
