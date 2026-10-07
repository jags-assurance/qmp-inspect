-- S7-18: signature pad + evidence upload on the handover acknowledgement. Idempotent; additive.
--
--  1. handover_certificates gets ack_signature (the drawn signature as a PNG/JPEG data URL, the same
--     format and size cap the inspection sign-off uses), ack_evidence_path / ack_evidence_name /
--     ack_evidence_size (an optional supporting file: a signed acceptance letter, an email export...)
--     and ack_has_signature, a stored generated boolean so list pages can show "signed" without
--     pulling the image itself.
--  2. Storage (bucket generated-documents, prefix handover-ack/<data book id>/...): the evidence file.
--     Readable by whoever can read the handover (can_read_handover: project staff + the client);
--     uploadable by the same people while the certificate is still awaiting acknowledgement; the
--     uploader may remove their own file only while nothing acknowledged references it.
--  3. acknowledge_handover() gains p_signature, p_evidence_path, p_evidence_name, p_evidence_size (all
--     optional, so an older app build that sends the earlier seven arguments keeps working). It
--     validates the signature format/size and that the evidence object really exists under this book's
--     handover-ack prefix. The old seven-argument function is dropped first: with defaults on the new
--     one, keeping both would make a named-argument call ambiguous.
--
-- The certificate write lock (20261020000100) still holds: the only writer is this SECURITY DEFINER
-- function. Requires can_read_handover() (20261101000100) and the reject/reminder columns
-- (20261108000102). Does not edit earlier migrations.

alter table public.handover_certificates
  add column if not exists ack_signature text,
  add column if not exists ack_evidence_path text,
  add column if not exists ack_evidence_name text,
  add column if not exists ack_evidence_size bigint;

-- Generated columns cannot be added with "if not exists" semantics inside a single statement that is
-- also safe to re-run, so guard it.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'handover_certificates' and column_name = 'ack_has_signature'
  ) then
    alter table public.handover_certificates
      add column ack_has_signature boolean generated always as (ack_signature is not null) stored;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.handover_certificates'::regclass and conname = 'handover_certificates_ack_signature_format'
  ) then
    alter table public.handover_certificates
      add constraint handover_certificates_ack_signature_format
      check (
        ack_signature is null
        or (ack_signature ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+=*$' and length(ack_signature) <= 700000)
      );
  end if;
end
$$;

comment on column public.handover_certificates.ack_signature is
  'Client signature drawn on the acknowledgement pad (PNG/JPEG data URL, max 700000 chars).';
comment on column public.handover_certificates.ack_evidence_path is
  'generated-documents path (handover-ack/<data book id>/...) of the supporting file attached to the acknowledgement.';
comment on column public.handover_certificates.ack_has_signature is
  'True when a signature was captured; lets list pages avoid selecting the image itself.';

-- ===== Storage: handover-ack/<data book id>/<file> in generated-documents =====
drop policy if exists generated_documents_handover_ack_select on storage.objects;
create policy generated_documents_handover_ack_select on storage.objects for select using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover-ack'
  and (storage.foldername(name))[2] in (
    select db.id::text from public.data_books db join public.projects p on p.id = db.project_id
    where public.can_read_handover(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_handover_ack_insert on storage.objects;
create policy generated_documents_handover_ack_insert on storage.objects for insert with check (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover-ack'
  and (storage.foldername(name))[2] in (
    select db.id::text
    from public.data_books db
      join public.projects p on p.id = db.project_id
      join public.handover_certificates hc on hc.data_book_id = db.id
    where db.status = 'issued'
      and hc.acknowledged_at is null
      and hc.rejected_at is null
      and hc.superseded_at is null
      and public.can_read_handover(p.id, p.organization_id)
  )
);

drop policy if exists generated_documents_handover_ack_delete on storage.objects;
create policy generated_documents_handover_ack_delete on storage.objects for delete using (
  bucket_id = 'generated-documents'
  and (storage.foldername(name))[1] = 'handover-ack'
  and owner = auth.uid()
  and not exists (
    select 1 from public.handover_certificates hc where hc.ack_evidence_path = storage.objects.name
  )
);

-- ===== acknowledge_handover: signature + evidence =====
drop function if exists public.acknowledge_handover(uuid, text, text, text, text, text, text);

create or replace function public.acknowledge_handover(
  target_certificate_id uuid,
  received_name text,
  received_company text,
  p_comment text default null,
  p_user_agent text default null,
  p_ip text default null,
  p_on_behalf_basis text default null,
  p_signature text default null,
  p_evidence_path text default null,
  p_evidence_name text default null,
  p_evidence_size bigint default null
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
  v_signature text := nullif(btrim(coalesce(p_signature, '')), '');
  v_evidence_path text := nullif(btrim(coalesce(p_evidence_path, '')), '');
  v_evidence_name text := nullif(btrim(coalesce(p_evidence_name, '')), '');
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
  if v_signature is not null and (
       v_signature !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+=*$' or length(v_signature) > 700000
     ) then
    raise exception 'The signature must be a PNG or JPEG image drawn on the signature pad';
  end if;
  if v_evidence_name is not null and length(v_evidence_name) > 255 then
    raise exception 'The evidence file name is too long';
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
  if v_cert.rejected_at is not null then
    raise exception 'This certificate was rejected and can no longer be acknowledged';
  end if;
  if v_cert.superseded_at is not null then
    raise exception 'This certificate was superseded by a later revision';
  end if;

  -- The evidence file must be this book's own handover-ack object and must exist and be non-empty.
  if v_evidence_path is not null then
    if left(v_evidence_path, length('handover-ack/' || v_cert.data_book_id::text || '/')) <> 'handover-ack/' || v_cert.data_book_id::text || '/'
       or position('..' in v_evidence_path) > 0 then
      raise exception 'The evidence file does not belong to this handover package';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'generated-documents'
        and o.name = v_evidence_path
        and coalesce((o.metadata ->> 'size')::bigint, 0) > 0
    ) then
      raise exception 'The evidence file was not found in storage (or is empty); upload it again';
    end if;
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
      ack_on_behalf_basis = case when v_on_behalf then nullif(btrim(coalesce(p_on_behalf_basis, '')), '') end,
      ack_signature = v_signature,
      ack_evidence_path = v_evidence_path,
      ack_evidence_name = case when v_evidence_path is not null then v_evidence_name end,
      ack_evidence_size = case when v_evidence_path is not null then p_evidence_size end
  where id = target_certificate_id and acknowledged_at is null;
end;
$$;

revoke all on function public.acknowledge_handover(uuid, text, text, text, text, text, text, text, text, text, bigint) from public, anon;
grant execute on function public.acknowledge_handover(uuid, text, text, text, text, text, text, text, text, text, bigint) to authenticated, service_role;
