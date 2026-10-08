-- S7-11: the `issue_handover` custom permission. Idempotent; no data changes.
--
-- Until now a conditional handover (a Data Book compiled with a documented override) could only be
-- issued by a JAGS Admin. This adds a fixed custom-role permission key, `issue_handover`, so an Admin
-- can delegate exactly that step to named JAGS staff (via Roles > permissions) without making them
-- Admins. Routine (non-conditional) issuing is unchanged: any JAGS staff member with project access.
-- Compile-with-override and withdrawing a compiled book stay Admin-only.
--
--  1. custom_role_permissions.permission_key check gains 'issue_handover'. NOT added to the
--     self-managed-client write policy's allow-list, so only a JAGS Admin can grant it.
--  2. issue_data_book_handover() (same signature) lets a holder of issue_handover for the book's
--     project issue a conditional handover. The caller must still be JAGS staff with project access.
--
-- Does not edit earlier migrations; the function below supersedes 20261101000100's definition.

alter table public.custom_role_permissions
  drop constraint if exists custom_role_permissions_permission_key_check,
  add constraint custom_role_permissions_permission_key_check check (permission_key in (
    'add_project_party',
    'reassign_project_party',
    'manage_intervention_levels',
    'issue_irn',
    'close_ncr',
    'view_org_reports',
    'approve_vault_document',
    'approve_itp',
    'provision_party_login',
    'close_punch_item',
    'run_standalone_assignment',
    'issue_handover'
  ));

create or replace function public.issue_data_book_handover(
  p_data_book_id uuid,
  p_package_storage_path text,
  p_package_sha256 text,
  p_notes text,
  p_certificate_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_book public.data_books%rowtype;
  v_org uuid;
  v_cert uuid;
  v_number text;
  v_seq int;
  v_fail text[];
  v_prefix text := 'handover/' || p_data_book_id::text || '/';
  v_system boolean := public.is_system_caller();
  v_prev_refs text[];
begin
  select * into v_book from public.data_books where id = p_data_book_id for update;
  if not found then
    raise exception 'Data Book not found';
  end if;
  select organization_id into v_org from public.projects where id = v_book.project_id;

  if not v_system then
    if auth.uid() is null or not public.is_jags_staff() then
      raise exception 'Only JAGS staff can issue a handover certificate';
    end if;
    if not public.has_project_access(v_book.project_id, v_org) then
      raise exception 'No access to this project';
    end if;
  end if;

  if v_book.status <> 'compiled' then
    raise exception 'Only a compiled Data Book can be issued for handover';
  end if;

  if p_package_storage_path is null
     or left(p_package_storage_path, length(v_prefix)) <> v_prefix
     or position('..' in p_package_storage_path) > 0 then
    raise exception 'Package path must start with handover/<data_book_id>/';
  end if;
  if p_package_sha256 is not null and p_package_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Package SHA-256 must be 64 lowercase hex characters';
  end if;

  -- The certified package must really exist (a direct API call cannot certify a missing file).
  if not v_system and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'generated-documents' and o.name = p_package_storage_path
      and coalesce((o.metadata ->> 'size')::bigint, 1) > 0
  ) then
    raise exception 'Package file was not found in storage (or is empty); upload it again';
  end if;

  if v_book.override_open_punch_items then
    -- S7-11: a conditional handover needs an Admin OR a JAGS staff member who was explicitly granted
    -- the issue_handover custom permission for this project (segregation of duties without making
    -- every conditional issue wait for one of the few Admins).
    if not v_system
       and not public.is_admin_staff()
       and not public.has_custom_permission(auth.uid(), 'issue_handover', v_book.project_id) then
      raise exception 'Only admin staff or a holder of issue_handover can issue a conditional handover';
    end if;
  else
    -- Same rule as compile: a non-overridden book must pass the gates at issue time.
    v_fail := public.data_book_gate_failures(v_book.project_id);
    if coalesce(array_length(v_fail, 1), 0) > 0 then
      raise exception 'Not ready to issue (punch/NCR/ITP/project gates): %', array_to_string(v_fail, '; ');
    end if;
  end if;

  v_number := nullif(btrim(coalesce(p_certificate_number, '')), '');
  if v_number is null then
    begin
      v_seq := public.next_document_sequence(v_org, v_book.project_id, 'handover_certificate');
      v_number := 'HC-' || lpad(v_seq::text, 3, '0');
    exception when others then
      v_number := 'HC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(p_data_book_id::text, '-', ''), 1, 8));
    end;
  end if;
  if exists (
    select 1 from public.handover_certificates hc join public.data_books b on b.id = hc.data_book_id
    where b.project_id = v_book.project_id and lower(hc.certificate_number) = lower(v_number)
  ) then
    raise exception 'Certificate number % is already used on this project', v_number using errcode = '23505';
  end if;

  perform set_config('app.issue_rpc', '1', true);

  insert into public.handover_certificates (
    data_book_id, certificate_number, issued_by, package_storage_path, package_sha256, notes,
    is_conditional, conditional_reason, conditional_open_items
  ) values (
    p_data_book_id, v_number, auth.uid(), p_package_storage_path, p_package_sha256, nullif(btrim(coalesce(p_notes, '')), ''),
    v_book.override_open_punch_items,
    case when v_book.override_open_punch_items then v_book.override_reason end,
    case when v_book.override_open_punch_items then v_book.override_items end
  ) returning id into v_cert;

  update public.data_books set status = 'issued' where id = p_data_book_id and status = 'compiled';

  perform set_config('app.issue_rpc', '', true);

  -- Revision support: the earlier certificate(s) on this project are superseded, and so are their
  -- live vault copies (certificate + data book), so the portal and vault show ONE current handover.
  select coalesce(array_agg(x.ref), '{}') into v_prev_refs from (
    select hc.certificate_number as ref
      from public.handover_certificates hc join public.data_books b on b.id = hc.data_book_id
     where b.project_id = v_book.project_id and hc.id <> v_cert and hc.superseded_at is null
    union
    select b.book_number
      from public.data_books b
     where b.project_id = v_book.project_id and b.id <> p_data_book_id and b.status = 'issued'
  ) x;

  update public.handover_certificates hc
     set superseded_at = now(), superseded_by_certificate_id = v_cert
    from public.data_books b
   where b.id = hc.data_book_id and b.project_id = v_book.project_id
     and hc.id <> v_cert and hc.superseded_at is null;

  if coalesce(array_length(v_prev_refs, 1), 0) > 0 then
    update public.vault_documents d
       set status = 'superseded'
     where d.status = 'approved'
       and d.document_reference = any (v_prev_refs)
       and d.folder_id in (select f.id from public.vault_folders f where f.project_id = v_book.project_id);
  end if;

  return v_cert;
end;
$$;

revoke all on function public.issue_data_book_handover(uuid, text, text, text, text) from public, anon;
grant execute on function public.issue_data_book_handover(uuid, text, text, text, text) to authenticated, service_role;
