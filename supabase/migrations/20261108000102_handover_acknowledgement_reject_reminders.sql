-- S7-18: reject flow + reminder bookkeeping for handover acknowledgement. Idempotent; additive only.
--
-- Until now a client could only accept a handover certificate. This adds:
--  1. Columns on handover_certificates for a REJECTION (who, when, why) and for the reminder sweep
--     (ack_reminder_count / last_ack_reminder_at, written by the worker with the service role).
--  2. reject_handover(certificate, reason): the client (same definition of "the client" as
--     acknowledge_handover) refuses the package with a reason of at least 10 characters. It is final for
--     that certificate: the issuer follows up and issues a new revision, which supersedes the rejected one.
--     Admin staff cannot reject on the client's behalf (a rejection is the client's own statement).
--  3. reopen_handover_rejection(certificate, reason): admin staff may clear a rejection that was made in
--     error, with a reason; the app records it in the audit log.
--  4. acknowledge_handover() (same signature) now refuses a rejected or superseded certificate.
--
-- The certificate write lock (20261020000100) still holds: every write goes through these SECURITY DEFINER
-- functions or the service role. Does not edit earlier migrations.

alter table public.handover_certificates
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.users (id) on delete set null,
  add column if not exists rejection_reason text,
  add column if not exists rejection_user_agent text,
  add column if not exists rejection_ip text,
  add column if not exists ack_reminder_count integer not null default 0,
  add column if not exists last_ack_reminder_at timestamptz;

comment on column public.handover_certificates.rejected_at is
  'Set when the client rejected the handover package (reject_handover). Final for this certificate.';
comment on column public.handover_certificates.rejection_reason is
  'Why the client rejected the package (10-2000 characters).';
comment on column public.handover_certificates.ack_reminder_count is
  'Reminders sent to the client so far (worker automation sweep).';
comment on column public.handover_certificates.last_ack_reminder_at is
  'When the last acknowledgement reminder was sent.';

create index if not exists handover_certificates_awaiting_ack_idx
  on public.handover_certificates (issued_date)
  where acknowledged_at is null and rejected_at is null and superseded_at is null;

-- ===== reject_handover =====
create or replace function public.reject_handover(
  target_certificate_id uuid,
  p_reason text,
  p_user_agent text default null,
  p_ip text default null
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
  v_reason text := btrim(coalesce(p_reason, ''));
  v_is_client boolean;
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

  if length(v_reason) < 10 then
    raise exception 'A rejection reason of at least 10 characters is required';
  end if;
  if length(v_reason) > 2000 then
    raise exception 'The rejection reason is too long';
  end if;

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
    raise exception 'Only the client organisation can reject a handover certificate';
  end if;

  if v_cert.acknowledged_at is not null then
    raise exception 'Already acknowledged';
  end if;
  if v_cert.rejected_at is not null then
    raise exception 'Already rejected';
  end if;
  if v_cert.superseded_at is not null then
    raise exception 'This certificate was superseded by a later revision';
  end if;

  update public.handover_certificates
     set rejected_at = now(),
         rejected_by = v_uid,
         rejection_reason = v_reason,
         rejection_user_agent = left(p_user_agent, 400),
         rejection_ip = left(p_ip, 80)
   where id = target_certificate_id and acknowledged_at is null and rejected_at is null;
end;
$$;

revoke all on function public.reject_handover(uuid, text, text, text) from public, anon;
grant execute on function public.reject_handover(uuid, text, text, text) to authenticated, service_role;

-- ===== reopen_handover_rejection (admin staff) =====
create or replace function public.reopen_handover_rejection(
  target_certificate_id uuid,
  p_reason text
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
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.is_admin_staff() then
    raise exception 'Only admin staff can reopen a rejected handover certificate';
  end if;

  select * into v_cert from public.handover_certificates where id = target_certificate_id for update;
  if not found then
    raise exception 'Handover certificate not found';
  end if;

  select p.id, p.organization_id into v_project, v_org
  from public.data_books db join public.projects p on p.id = db.project_id
  where db.id = v_cert.data_book_id;
  if not public.has_project_access(v_project, v_org) then
    raise exception 'No access to this project';
  end if;

  if v_cert.rejected_at is null then
    raise exception 'This certificate has not been rejected';
  end if;
  if v_cert.superseded_at is not null then
    raise exception 'This certificate was superseded by a later revision';
  end if;
  if length(v_reason) < 10 then
    raise exception 'A reason of at least 10 characters is required';
  end if;

  update public.handover_certificates
     set rejected_at = null, rejected_by = null, rejection_reason = null,
         rejection_user_agent = null, rejection_ip = null,
         ack_reminder_count = 0, last_ack_reminder_at = null
   where id = target_certificate_id and rejected_at is not null;
end;
$$;

revoke all on function public.reopen_handover_rejection(uuid, text) from public, anon;
grant execute on function public.reopen_handover_rejection(uuid, text) to authenticated, service_role;

-- ===== acknowledge_handover: refuse rejected / superseded certificates =====
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
  if v_cert.rejected_at is not null then
    raise exception 'This certificate was rejected and can no longer be acknowledged';
  end if;
  if v_cert.superseded_at is not null then
    raise exception 'This certificate was superseded by a later revision';
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
