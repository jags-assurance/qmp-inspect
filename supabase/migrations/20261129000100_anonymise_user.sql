-- U6: anonymise_user(p_user_id, p_reason) - the database half of the "deletion request" process
-- (docs/DATA_SUBJECT_REQUESTS.md).
--
-- What it does, for one account, in a single transaction:
--   * replaces the personal fields on public.users: full_name -> 'Former user', email -> a
--     non-reversible placeholder 'anonymised-<user id>@anonymised.invalid' (the id is a random uuid
--     that was never derived from the email, and .invalid is a reserved TLD that can never receive
--     mail). public.users has no phone or address column, so those are the only personal fields;
--   * deactivates the account (is_active = false), so every RLS helper stops recognising it;
--   * scrubs the person's own text identifiers on the few related tables that copy a name or email
--     into a row keyed by this user or by their email (project party members and contacts, document
--     transmittal recipients, signed-by names on inspections, handover receiver names);
--   * writes one audit_log row (platform-wide, actor = the admin, reason recorded, no old values).
-- What it never does: delete a row, change a foreign key, edit audit_log, or touch access_grants
-- (deactivation already makes them inert; the app's deactivation action removes them when asked).
-- The Auth user (auth.users) is changed by the web action through the Supabase admin API, not here.
--
-- Guards: JAGS Admin only (is_admin_staff()); a reason of at least 10 characters; refuses the
-- caller's own account and the last active JAGS Admin; idempotent (a second call on an account that
-- is already anonymised changes nothing and returns status 'already_anonymised'). Related-table
-- scrubs are best-effort per table (missing table/column is skipped; a table whose own guard trigger
-- refuses the update is reported under "skipped" instead of failing the whole request).
-- Free text typed into records (comments, captions, notification text, audit summaries, signature
-- images) is intentionally left alone: it belongs to the quality record.
-- Idempotent, forward-only, additive.

create or replace function public.anonymise_user(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_user public.users%rowtype;
  v_name constant text := 'Former user';
  v_placeholder text;
  v_old_email text;
  -- table -> {column: value}, and the columns that identify this person's rows
  v_plan constant jsonb := '[
    {"t": "project_party_members", "set": {"invited_email": "@email"}, "by_user": "user_id", "by_email": "invited_email"},
    {"t": "project_parties", "set": {"contact_name": "@name", "contact_email": "@email"}, "by_email": "contact_email"},
    {"t": "document_transmittals", "set": {"recipient_email": "@email"}, "by_email": "recipient_email"},
    {"t": "inspection_records", "set": {"signed_by_name": "@name"}, "by_user": "signed_by_user_id"},
    {"t": "handover_certificates", "set": {"received_by_name": "@name"}, "by_user": "acknowledged_by"}
  ]'::jsonb;
  v_item jsonb;
  v_table text;
  v_sets text[];
  v_conds text[];
  v_kv record;
  v_n bigint;
  v_touched jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_actor is null or not public.is_admin_staff() then
    raise exception 'Only a JAGS Admin can anonymise an account.' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'A user id is required.' using errcode = '22023';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'A reason of at least 10 characters is required.' using errcode = '22023';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot anonymise your own account.' using errcode = 'P0001';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  v_placeholder := 'anonymised-' || p_user_id::text || '@anonymised.invalid';
  if v_user.email = v_placeholder then
    return jsonb_build_object('status', 'already_anonymised', 'user_id', p_user_id);
  end if;

  -- Never remove the last active admin (users_protect_last_admin enforces the same on the update).
  if v_user.is_jags_staff and v_user.is_active and v_user.staff_role is distinct from 'inspector'
     and not exists (
       select 1
       from public.users u
       join public.access_grants g on g.user_id = u.id and g.scope_type = 'global'
       where u.id <> p_user_id and u.is_jags_staff and u.is_active and u.staff_role is distinct from 'inspector'
     ) then
    raise exception 'This is the last active JAGS Admin, so the account cannot be anonymised.' using errcode = 'P0001';
  end if;

  v_old_email := btrim(coalesce(v_user.email, ''));

  update public.users
     set full_name = v_name,
         email = v_placeholder,
         is_active = false,
         updated_at = now()
   where id = p_user_id;

  for v_item in select * from jsonb_array_elements(v_plan) loop
    v_table := v_item ->> 't';
    v_sets := '{}';
    v_conds := '{}';

    if to_regclass(format('public.%I', v_table)) is null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('table', v_table, 'reason', 'table not present'));
      continue;
    end if;

    for v_kv in select key, value from jsonb_each_text(v_item -> 'set') loop
      if exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = v_table and column_name = v_kv.key) then
        v_sets := v_sets || format('%I = %L', v_kv.key, case v_kv.value when '@email' then v_placeholder else v_name end);
      end if;
    end loop;

    if v_item ? 'by_user' and exists (select 1 from information_schema.columns
         where table_schema = 'public' and table_name = v_table and column_name = v_item ->> 'by_user') then
      v_conds := v_conds || format('%I = %L', v_item ->> 'by_user', p_user_id);
    end if;
    if v_item ? 'by_email' and v_old_email <> '' and exists (select 1 from information_schema.columns
         where table_schema = 'public' and table_name = v_table and column_name = v_item ->> 'by_email') then
      v_conds := v_conds || format('lower(%I) = lower(%L)', v_item ->> 'by_email', v_old_email);
    end if;

    if coalesce(array_length(v_sets, 1), 0) = 0 or coalesce(array_length(v_conds, 1), 0) = 0 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('table', v_table, 'reason', 'columns not present'));
      continue;
    end if;

    begin
      execute format('update public.%I set %s where %s', v_table, array_to_string(v_sets, ', '), array_to_string(v_conds, ' or '));
      get diagnostics v_n = row_count;
      v_touched := v_touched || jsonb_build_object(v_table, v_n);
    exception when others then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('table', v_table, 'reason', sqlerrm));
    end;
  end loop;

  -- Platform-wide audit event (no organisation). Old name/email are deliberately not recorded.
  insert into public.audit_log (organization_id, project_id, entity_type, entity_id, action, actor_id, summary, changes)
  values (
    null, null, 'user', p_user_id, 'anonymised', v_actor,
    'Account anonymised and deactivated (personal identifiers replaced; records kept)',
    jsonb_build_object(
      'reason', v_reason,
      'fields_replaced', jsonb_build_array('users.full_name', 'users.email'),
      'rows_changed', v_touched,
      'skipped', v_skipped
    )
  );

  return jsonb_build_object(
    'status', 'anonymised',
    'user_id', p_user_id,
    'rows_changed', v_touched,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function public.anonymise_user(uuid, text) from public, anon;
grant execute on function public.anonymise_user(uuid, text) to authenticated;

comment on function public.anonymise_user(uuid, text) is
  'U6: JAGS Admin only. Replaces the personal identifiers of one account with placeholders, deactivates it, keeps every record and foreign key, writes an audit event. Idempotent.';
