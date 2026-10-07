-- Stage 6 / 7 (agent A). Idempotent; safe on existing data.
--
--  S7-20  close_project(): an override reason must be a real reason (>= 5 chars) and is now recorded
--         (audit_log row). The completed-project write lock also covers the registers and ITPs.
--  S6-13  issue_irn(): allocates the number and inserts the IRN in ONE transaction (no burnt numbers),
--         and only looks at LIVE IRNs (S6-01: a voided IRN no longer blocks a replacement).
--  S6-05/S6-08  reopen_inspection(): re-open + amendment history + IRN void + supersede of the filed
--         reports in ONE transaction (the void result is checked, nothing half-applies).
--  S7-26/S6-18  unguessable verification tokens for handover certificates and IRNs, and
--         verify_document(): a public, minimal-fact lookup (number / status / hash only).

-- ===== S7-20: completed-project write lock, extended =====
create or replace function public.project_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_pid uuid;
begin
  if pg_trigger_depth() > 1 or public.is_system_caller() or public.is_admin_staff() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name in ('ncrs', 'punch_list_items', 'inspection_records', 'standalone_assignments') then
    v_pid := nullif(v_row->>'project_id', '')::uuid;
  elsif tg_table_name = 'irns' then
    v_pid := nullif(v_row->>'project_id', '')::uuid;
    if v_pid is null then
      select r.project_id into v_pid from public.inspection_records r
        where r.id = nullif(v_row->>'inspection_record_id', '')::uuid;
    end if;
  elsif tg_table_name = 'checklist_responses' then
    select r.project_id into v_pid from public.inspection_records r
      where r.id = nullif(v_row->>'inspection_record_id', '')::uuid;
  elsif tg_table_name = 'activity_signoff_progress' then
    select i.project_id into v_pid
    from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
    where it.id = nullif(v_row->>'itp_item_id', '')::uuid;
  elsif tg_table_name = 'vault_documents' then
    select f.project_id into v_pid from public.vault_folders f
      where f.id = nullif(v_row->>'folder_id', '')::uuid;
  else
    -- registers, itps: a plain project_id column.
    v_pid := nullif(v_row->>'project_id', '')::uuid;
  end if;

  if v_pid is not null and not public.project_is_writable(v_pid) then
    raise exception 'This project is completed or cancelled; changes are not allowed';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.project_write_guard() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['calibration_register', 'welder_qualification_register', 'material_register',
                           'personnel_certifications', 'itps'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists project_write_guard on public.%I', t);
      execute format('create trigger project_write_guard before insert or update or delete on public.%I for each row execute function public.project_write_guard()', t);
    end if;
  end loop;
end $$;

create or replace function public.close_project(p_project_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_org uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select status, organization_id into v_status, v_org from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;
  if not public.is_system_caller() then
    if not public.is_admin_staff() then
      raise exception 'Only admin staff can close a project';
    end if;
    if not public.has_project_access(p_project_id, v_org) then
      raise exception 'No access to this project';
    end if;
  end if;
  if v_status = 'completed' then
    raise exception 'Project is already completed';
  end if;
  if v_reason is not null and length(v_reason) < 5 then
    raise exception 'A reason of at least 5 characters is required to close a project with open items';
  end if;

  if v_reason is not null then
    perform set_config('app.close_override', '1', true);
  end if;
  update public.projects set status = 'completed' where id = p_project_id;
  perform set_config('app.close_override', '', true);

  if v_reason is not null then
    insert into public.audit_log (organization_id, project_id, entity_type, entity_id, action, actor_id, summary, changes)
    values (v_org, p_project_id, 'project', p_project_id, 'close_override_reason', auth.uid(),
            'Project closed with the override reason: ' || left(v_reason, 500),
            jsonb_build_object('reason', v_reason, 'from', v_status));
  end if;
end;
$$;
revoke all on function public.close_project(uuid, text) from public, anon;
grant execute on function public.close_project(uuid, text) to authenticated, service_role;

-- ===== S6-01 / S6-13: issue_irn =====
-- SECURITY INVOKER on purpose: the irns RLS (can_issue_irn_for_record) and write guard still apply.
-- next_document_sequence is the existing definer counter; the sequence bump rolls back with the
-- transaction if the insert fails, so numbers are not burnt.
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
  v_seq := public.next_document_sequence(v_org, v_rec.project_id, 'irn:' || v_rec.itp_number);
  v_num := v_rec.itp_number || '-IRN-' || v_seq::text;

  insert into public.irns (inspection_record_id, irn_number, issued_by)
  values (p_inspection_record_id, v_num, auth.uid())
  returning id into v_id;

  return query select v_id, v_num, false;
end;
$$;
revoke all on function public.issue_irn(uuid) from public, anon;
grant execute on function public.issue_irn(uuid) to authenticated, service_role;

-- ===== S6-05 / S6-08: reopen_inspection =====
-- SECURITY INVOKER: the inspection_records / irns write guards and RLS apply. The caller's role
-- (admin staff or team lead) is checked by the app action.
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

  insert into public.inspection_record_amendments (
    record_id, amended_by, reason, previous_overall_result, previous_signed_by_name, previous_signed_at, previous_notes
  ) values (
    p_record_id, auth.uid(), v_reason, v_rec.overall_result, v_rec.signed_by_name, v_rec.signed_at, v_rec.notes
  );

  update public.inspection_records
     set overall_result = null, inspector_signature = null, signed_by_name = null, signed_at = null,
         witness_name = null, witness_signature = null
   where id = p_record_id and overall_result is not null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'This inspection was already re-opened';
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

  -- The filed inspection report (and the IRN certificate) no longer describe a completed record.
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

-- ===== S7-26 / S6-18: verification tokens + public verify =====
alter table public.handover_certificates add column if not exists verification_token text;
alter table public.irns add column if not exists verification_token text;

update public.handover_certificates
   set verification_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where verification_token is null;
update public.irns
   set verification_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where verification_token is null;

alter table public.handover_certificates
  alter column verification_token set default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
alter table public.irns
  alter column verification_token set default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

create unique index if not exists handover_certificates_verification_token_uidx
  on public.handover_certificates (verification_token);
create unique index if not exists irns_verification_token_uidx
  on public.irns (verification_token);

-- Public (anon-callable) and deliberately tiny: number, status, dates and hash only. No project,
-- organisation, party or user data is ever returned.
create or replace function public.verify_document(p_kind text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 or p_token !~ '^[0-9a-f]+$' then
    return jsonb_build_object('valid', false);
  end if;
  if p_kind = 'certificate' then
    select jsonb_build_object(
             'valid', true, 'kind', 'handover_certificate',
             'number', hc.certificate_number,
             'status', case when hc.superseded_at is not null then 'superseded'
                            when hc.acknowledged_at is not null then 'acknowledged' else 'issued' end,
             'issued_date', hc.issued_date,
             'conditional', coalesce(hc.is_conditional, false),
             'package_sha256', hc.package_sha256,
             'data_book_sha256', hc.rendered_book_sha256)
      into v
      from public.handover_certificates hc where hc.verification_token = p_token;
  elsif p_kind = 'irn' then
    select jsonb_build_object(
             'valid', true, 'kind', 'irn',
             'number', i.irn_number,
             'status', case when i.voided_at is not null then 'void' else 'live' end,
             'issued_date', i.release_date,
             'voided_at', i.voided_at)
      into v
      from public.irns i where i.verification_token = p_token;
  end if;
  return coalesce(v, jsonb_build_object('valid', false));
end;
$$;
revoke all on function public.verify_document(text, text) from public;
grant execute on function public.verify_document(text, text) to anon, authenticated, service_role;
