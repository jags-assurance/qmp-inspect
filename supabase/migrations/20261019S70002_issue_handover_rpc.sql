-- Stage 7: atomic Data Book issue + handover certificate. Idempotent.
-- Extra optional 5th arg p_certificate_number (certificate_number is NOT NULL and the app supplies it);
-- when null a number is generated. 4-arg named calls still work.
drop function if exists public.issue_data_book_handover(uuid, text, text, text);

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
  v_open int;
  v_prefix text := 'handover/' || p_data_book_id::text || '/';
  v_system boolean := public.is_system_caller();
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

  -- Same rule as the app: a non-overridden book must have no open punch items at issue time.
  if not v_book.override_open_punch_items then
    select count(*) into v_open from public.punch_list_items
      where project_id = v_book.project_id and status <> 'closed';
    if v_open > 0 then
      raise exception '% punch item(s) are open; close them or compile with a documented override', v_open;
    end if;
  end if;

  v_number := nullif(btrim(coalesce(p_certificate_number, '')), '');
  if v_number is null then
    v_number := 'HC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(p_data_book_id::text, '-', ''), 1, 8));
  end if;

  perform set_config('app.issue_rpc', '1', true);

  insert into public.handover_certificates (
    data_book_id, certificate_number, issued_by, package_storage_path, package_sha256,
    is_conditional, conditional_reason, conditional_open_items
  ) values (
    p_data_book_id, v_number, auth.uid(), p_package_storage_path, p_package_sha256,
    v_book.override_open_punch_items,
    case when v_book.override_open_punch_items then v_book.override_reason end,
    case when v_book.override_open_punch_items then v_book.override_items end
  ) returning id into v_cert;

  update public.data_books set status = 'issued' where id = p_data_book_id and status = 'compiled';

  perform set_config('app.issue_rpc', '', true);
  return v_cert;
end;
$$;

revoke all on function public.issue_data_book_handover(uuid, text, text, text, text) from public, anon;
grant execute on function public.issue_data_book_handover(uuid, text, text, text, text) to authenticated, service_role;
