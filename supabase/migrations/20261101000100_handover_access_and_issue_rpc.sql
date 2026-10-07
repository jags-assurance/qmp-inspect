-- Stage 7 hardening (agent A). Idempotent; safe on existing data; no destructive change.
--
--  S7-01  handover_certificates / data_books / handover package storage were readable by EVERY project
--         role (has_project_access). Reads are now limited to JAGS staff on the project and client-role
--         grants (org or project scope) via can_read_handover().
--  S7-02  issue_data_book_handover(): the typed certificate reference was thrown away. The RPC now
--         stores p_notes, uses p_certificate_number when given, otherwise draws a project-scoped
--         sequential HC-### from next_document_sequence().
--  S7-05  compiled -> draft ("withdraw") through withdraw_data_book() (admin staff + reason).
--  S7-09  draft -> compiled only through compile_data_book() (server-side gate + override rules).
--  S7-10  issue verifies that the package object exists in storage and is non-empty.
--  S7-11  an override compile / conditional issue needs admin staff.
--  S7-12  issue re-applies the same gates as compile (open punch / NCRs / project not completed).
--  S7-17  acknowledge_handover(): admin must have project access; org role 'member' no longer counts
--         as the client (the app action only ever accepted 'client'). Adds ack metadata + comment.
--  S7-19  revision reason + supersedes link on data_books; issuing supersedes the earlier certificate
--         and its vault copies.
--  S7-22  handover/ package uploads only into a COMPILED book; staff may delete them again while the
--         book is compiled (cleanup of a rejected issue).
-- Does not edit earlier migrations; later migrations of the chain are the ones being superseded.

-- ===== 0. Columns =====
alter table public.handover_certificates
  add column if not exists notes text,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_certificate_id uuid,
  add column if not exists rendered_book_path text,
  add column if not exists rendered_book_sha256 text,
  add column if not exists ack_comment text,
  add column if not exists ack_user_agent text,
  add column if not exists ack_ip text,
  add column if not exists ack_on_behalf_basis text;

alter table public.data_books
  add column if not exists revision_reason text,
  add column if not exists supersedes_data_book_id uuid references public.data_books (id) on delete set null;

comment on column public.handover_certificates.notes is
  'Free-text note / typed certificate reference supplied by staff at issue time.';
comment on column public.handover_certificates.rendered_book_path is
  'generated-documents path of the Data Book PDF rendered (by the worker) for this ISSUED book; frozen after the first render.';
comment on column public.handover_certificates.rendered_book_sha256 is
  'SHA-256 of rendered_book_path, computed by the worker.';
comment on column public.data_books.revision_reason is
  'Why this revision exists (required by the app when an earlier book was already issued).';

-- ===== 1. Who may read handover material =====
create or replace function public.can_read_handover(p_project_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (public.is_jags_staff() and public.has_project_access(p_project_id, p_org_id))
    or exists (
      select 1 from public.access_grants g
      where g.user_id = auth.uid()
        and g.role = 'client'
        and (
          (g.scope_type = 'organization' and g.organization_id = p_org_id)
          or (g.scope_type = 'project' and g.project_id = p_project_id)
        )
    );
$$;
revoke all on function public.can_read_handover(uuid, uuid) from public, anon;
grant execute on function public.can_read_handover(uuid, uuid) to authenticated, service_role;

drop policy if exists data_books_select on public.data_books;
create policy data_books_select on public.data_books for select using (
  exists (select 1 from public.projects p
          where p.id = data_books.project_id and public.can_read_handover(p.id, p.organization_id))
);

drop policy if exists handover_certificates_select on public.handover_certificates;
create policy handover_certificates_select on public.handover_certificates for select using (
  exists (select 1 from public.data_books db join public.projects p on p.id = db.project_id
          where db.id = handover_certificates.data_book_id and public.can_read_handover(p.id, p.organization_id))
);

-- Storage: handover/<book id>/... (package files)
drop policy if exists generated_documents_handover_select on storage.objects;
create policy generated_documents_handover_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover'
  and (storage.foldername(name))[2] in (
    select db.id::text from public.data_books db join public.projects p on p.id = db.project_id
    where public.can_read_handover(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_handover_insert on storage.objects;
create policy generated_documents_handover_insert on storage.objects for insert with check (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover'
  and public.is_jags_staff()
  and (storage.foldername(name))[2] in (
    select db.id::text from public.data_books db join public.projects p on p.id = db.project_id
    where db.status = 'compiled' and public.has_project_access(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_handover_delete on storage.objects;
create policy generated_documents_handover_delete on storage.objects for delete using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover'
  and public.is_jags_staff()
  and (storage.foldername(name))[2] in (
    select db.id::text from public.data_books db join public.projects p on p.id = db.project_id
    where db.status = 'compiled' and public.has_project_access(p.id, p.organization_id)
  )
);

-- ===== 2. Shared gate (SQL subset of the app readiness rules) =====
-- Returns the reasons a book cannot be compiled / issued WITHOUT an override. The register / IRN
-- categories stay app-computed; these are the gates the database can verify cheaply and that a
-- direct API caller must not be able to skip.
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
begin
  select status into v_status from public.projects where id = p_project_id;
  if v_status is distinct from 'completed' then
    v_out := v_out || ('project status is ' || coalesce(v_status, 'unknown') || ', not completed');
  end if;
  select count(*) into v_n from public.punch_list_items where project_id = p_project_id and status <> 'closed';
  if v_n > 0 then v_out := v_out || (v_n || ' open punch item(s)'); end if;
  select count(*) into v_n from public.ncrs
    where project_id = p_project_id and status <> 'closed' and coalesce(severity, '') <> 'observation';
  if v_n > 0 then v_out := v_out || (v_n || ' open NCR(s)'); end if;
  select count(*) into v_n from public.itps
    where project_id = p_project_id
      and (status not in ('approved', 'client_accepted') or coalesce(revision_needs_approval, false));
  if v_n > 0 then v_out := v_out || (v_n || ' ITP(s) not approved'); end if;
  return v_out;
end;
$$;
revoke all on function public.data_book_gate_failures(uuid) from public, anon;
grant execute on function public.data_book_gate_failures(uuid) to authenticated, service_role;

-- ===== 3. compile_data_book / withdraw_data_book =====
create or replace function public.compile_data_book(
  p_data_book_id uuid,
  p_override boolean,
  p_override_reason text,
  p_override_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_book public.data_books%rowtype;
  v_org uuid;
  v_system boolean := public.is_system_caller();
  v_fail text[];
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select * into v_book from public.data_books where id = p_data_book_id for update;
  if not found then raise exception 'Data Book not found'; end if;
  select organization_id into v_org from public.projects where id = v_book.project_id;

  if not v_system then
    if auth.uid() is null or not public.is_jags_staff() then
      raise exception 'Only JAGS staff can compile a Data Book';
    end if;
    if not public.has_project_access(v_book.project_id, v_org) then
      raise exception 'No access to this project';
    end if;
  end if;
  if v_book.status <> 'draft' then
    raise exception 'Only a draft Data Book can be compiled';
  end if;

  v_fail := public.data_book_gate_failures(v_book.project_id);

  if coalesce(p_override, false) then
    if not v_system and not public.is_admin_staff() then
      raise exception 'Only admin staff can compile a Data Book with an override';
    end if;
    if v_reason is null or length(v_reason) < 10 then
      raise exception 'An override reason of at least 10 characters is required';
    end if;
    if length(v_reason) > 2000 then
      raise exception 'Override reason must be 2000 characters or fewer';
    end if;
  elsif coalesce(array_length(v_fail, 1), 0) > 0 then
    raise exception 'Data Book is not ready to compile: %', array_to_string(v_fail, '; ');
  end if;

  perform set_config('app.compile_rpc', '1', true);
  update public.data_books
     set status = 'compiled',
         compiled_by = auth.uid(),
         compiled_at = now(),
         override_open_punch_items = coalesce(p_override, false),
         override_reason = case when coalesce(p_override, false) then v_reason end,
         override_by = case when coalesce(p_override, false) then auth.uid() end,
         override_items = case when coalesce(p_override, false) then p_override_items end
   where id = p_data_book_id and status = 'draft';
  perform set_config('app.compile_rpc', '', true);
end;
$$;
revoke all on function public.compile_data_book(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.compile_data_book(uuid, boolean, text, jsonb) to authenticated, service_role;

create or replace function public.withdraw_data_book(p_data_book_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_book public.data_books%rowtype;
  v_org uuid;
  v_system boolean := public.is_system_caller();
begin
  select * into v_book from public.data_books where id = p_data_book_id for update;
  if not found then raise exception 'Data Book not found'; end if;
  select organization_id into v_org from public.projects where id = v_book.project_id;
  if not v_system then
    if auth.uid() is null or not public.is_admin_staff() then
      raise exception 'Only admin staff can withdraw a compiled Data Book';
    end if;
    if not public.has_project_access(v_book.project_id, v_org) then
      raise exception 'No access to this project';
    end if;
  end if;
  if v_book.status <> 'compiled' then
    raise exception 'Only a compiled Data Book can be withdrawn to draft';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;
  if exists (select 1 from public.handover_certificates where data_book_id = p_data_book_id) then
    raise exception 'This Data Book already has a handover certificate';
  end if;

  perform set_config('app.withdraw_rpc', '1', true);
  update public.data_books
     set status = 'draft', compiled_by = null, compiled_at = null,
         override_open_punch_items = false, override_reason = null, override_by = null, override_items = null
   where id = p_data_book_id and status = 'compiled';
  perform set_config('app.withdraw_rpc', '', true);
end;
$$;
revoke all on function public.withdraw_data_book(uuid, text) from public, anon;
grant execute on function public.withdraw_data_book(uuid, text) to authenticated, service_role;

-- Guard: draft -> compiled and compiled -> draft only through the RPCs above.
create or replace function public.data_books_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_system_caller() or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'A new Data Book must start as draft';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'issued' then
      raise exception 'An issued Data Book cannot be deleted';
    end if;
    if not public.is_admin_staff() then
      raise exception 'Only admin staff can delete a Data Book';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.revision is distinct from old.revision then
    raise exception 'Data Book revision is immutable';
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'Data Book project cannot be changed';
  end if;

  if old.status = 'issued' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'An issued Data Book is immutable; create a new revision instead';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'compiled' then
      if coalesce(current_setting('app.compile_rpc', true), '') <> '1' then
        raise exception 'Data Books can only be compiled through compile_data_book()';
      end if;
    elsif old.status = 'compiled' and new.status = 'draft' then
      if coalesce(current_setting('app.withdraw_rpc', true), '') <> '1' then
        raise exception 'A compiled Data Book can only be withdrawn through withdraw_data_book()';
      end if;
    elsif old.status = 'compiled' and new.status = 'issued' then
      if coalesce(current_setting('app.issue_rpc', true), '') <> '1' then
        raise exception 'Data Books can only be issued through issue_data_book_handover()';
      end if;
      if not exists (select 1 from public.handover_certificates hc where hc.data_book_id = old.id) then
        raise exception 'Cannot issue a Data Book without a handover certificate';
      end if;
    else
      raise exception 'Invalid Data Book status change: % -> %', old.status, new.status;
    end if;
  elsif old.status = 'compiled' and (
       new.override_open_punch_items is distinct from old.override_open_punch_items
    or new.override_reason is distinct from old.override_reason
    or new.override_by is distinct from old.override_by
    or new.compiled_by is distinct from old.compiled_by
    or new.compiled_at is distinct from old.compiled_at
  ) then
    raise exception 'The override and compile details of a compiled Data Book cannot be edited';
  end if;

  return new;
end;
$$;
revoke all on function public.data_books_guard() from public, anon, authenticated;

drop trigger if exists data_books_guard on public.data_books;
create trigger data_books_guard
  before insert or update or delete on public.data_books
  for each row execute function public.data_books_guard();

-- ===== 4. issue_data_book_handover (same signature; adds notes, number, object, gate, supersede) =====
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
    if not v_system and not public.is_admin_staff() then
      raise exception 'Only admin staff can issue a conditional handover';
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

-- ===== 5. acknowledge_handover (adds metadata; signature gains optional trailing args) =====
drop function if exists public.acknowledge_handover(uuid, text, text);

create or replace function public.acknowledge_handover(
  target_certificate_id uuid,
  received_name text,
  received_company text,
  p_comment text default null,
  p_user_agent text default null,
  p_ip text default null,
  p_on_behalf_basis text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cert public.handover_certificates%rowtype;
  v_project uuid;
  v_org uuid;
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(received_name, ''));
  v_company text := nullif(btrim(coalesce(received_company, '')), '');
  v_is_client boolean;
  v_on_behalf boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_cert from public.handover_certificates where id = target_certificate_id for update;
  if not found then
    raise exception 'Handover certificate not found';
  end if;

  select p.id, p.organization_id into v_project, v_org
  from public.data_books db join public.projects p on p.id = db.project_id
  where db.id = v_cert.data_book_id;

  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Received-by name must be between 2 and 120 characters';
  end if;
  if v_company is not null and length(v_company) > 200 then
    raise exception 'Company name is too long';
  end if;
  if p_comment is not null and length(p_comment) > 2000 then
    raise exception 'Comment is too long';
  end if;

  -- Same definition of "the client" as the app action: role client, org- or project-scoped.
  select exists (
    select 1 from public.access_grants g
    where g.user_id = v_uid
      and g.role = 'client'
      and (
        (g.scope_type = 'organization' and g.organization_id = v_org)
        or (g.scope_type = 'project' and g.project_id = v_project)
      )
  ) into v_is_client;

  if not v_is_client then
    if public.is_admin_staff() and public.has_project_access(v_project, v_org) then
      v_on_behalf := true;
    else
      raise exception 'Not authorized to acknowledge this handover certificate';
    end if;
  end if;

  if v_cert.package_storage_path is null then
    raise exception 'Certificate has no handover package; it cannot be acknowledged';
  end if;
  if v_cert.acknowledged_at is not null then
    raise exception 'Already acknowledged';
  end if;

  update public.handover_certificates
  set acknowledged_at = now(),
      received_by_name = v_name,
      received_by_company = v_company,
      acknowledged_by = v_uid,
      acknowledged_by_role = case when v_on_behalf then 'admin_staff' else 'client' end,
      acknowledged_on_behalf = v_on_behalf,
      ack_comment = nullif(btrim(coalesce(p_comment, '')), ''),
      ack_user_agent = left(p_user_agent, 400),
      ack_ip = left(p_ip, 80),
      ack_on_behalf_basis = case when v_on_behalf then nullif(btrim(coalesce(p_on_behalf_basis, '')), '') end
  where id = target_certificate_id and acknowledged_at is null;
end;
$$;

revoke all on function public.acknowledge_handover(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.acknowledge_handover(uuid, text, text, text, text, text, text) to authenticated, service_role;
