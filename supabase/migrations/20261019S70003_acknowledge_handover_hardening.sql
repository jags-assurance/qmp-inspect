-- Stage 7: harden acknowledge_handover. Idempotent. Signature unchanged.
alter table public.handover_certificates
  add column if not exists acknowledged_by uuid references public.users (id),
  add column if not exists acknowledged_by_role text,
  add column if not exists acknowledged_on_behalf boolean not null default false;

create or replace function public.acknowledge_handover(
  target_certificate_id uuid,
  received_name text,
  received_company text
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

  select exists (
    select 1 from public.access_grants g
    where g.user_id = v_uid
      and (
        (g.scope_type = 'organization' and g.organization_id = v_org and g.role in ('client', 'member'))
        or (g.scope_type = 'project' and g.project_id = v_project and g.role = 'client')
      )
  ) into v_is_client;

  if not v_is_client then
    if public.is_admin_staff() then
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
      acknowledged_on_behalf = v_on_behalf
  where id = target_certificate_id and acknowledged_at is null;
end;
$$;

revoke all on function public.acknowledge_handover(uuid, text, text) from public, anon;
grant execute on function public.acknowledge_handover(uuid, text, text) to authenticated, service_role;
