-- issue_irn: skip IRN numbers already in use on the project.
-- The per-ITP counter ('irn:<itp_number>') can fall behind IRNs that exist without having used it
-- (seeded or imported rows). Every attempt then got the same number, hit the unique index
-- irns_project_number_key and failed ("Could not issue the IRN") for good, because the failed
-- insert rolls the counter bump back too. Keep drawing numbers until an unused one comes up.
-- Idempotent (create or replace); same signature, security and grants as before.
create or replace function public.issue_irn(p_inspection_record_id uuid)
returns table (out_id uuid, out_number text, out_already boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rec public.inspection_records%rowtype;
  v_org uuid;
  v_seq int;
  v_id uuid;
  v_num text;
  v_ex_id uuid;
  v_ex_num text;
  v_tries int := 0;
begin
  select * into v_rec from public.inspection_records where id = p_inspection_record_id;
  if not found then
    raise exception 'Inspection record not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('irn:' || p_inspection_record_id::text, 0));

  -- Only a LIVE IRN counts: a voided one must be replaceable (S6-01).
  select i.id, i.irn_number into v_ex_id, v_ex_num
    from public.irns i
   where i.inspection_record_id = p_inspection_record_id and i.voided_at is null
   limit 1;
  if found then
    return query select v_ex_id, v_ex_num, true;
    return;
  end if;

  select p.organization_id into v_org from public.projects p where p.id = v_rec.project_id;

  loop
    v_seq := public.next_document_sequence(v_org, v_rec.project_id, 'irn:' || v_rec.itp_number);
    v_num := v_rec.itp_number || '-IRN-' || v_seq::text;
    exit when not exists (
      select 1 from public.irns i
       where i.irn_number = v_num and i.project_id = v_rec.project_id
    );
    v_tries := v_tries + 1;
    if v_tries > 1000 then
      raise exception 'Could not find an unused IRN number for %', v_rec.itp_number;
    end if;
  end loop;

  insert into public.irns (inspection_record_id, irn_number, issued_by)
  values (p_inspection_record_id, v_num, auth.uid())
  returning id into v_id;

  return query select v_id, v_num, false;
end;
$$;
revoke all on function public.issue_irn(uuid) from public, anon;
grant execute on function public.issue_irn(uuid) to authenticated, service_role;
