-- Atomic filing of worker-generated documents into the vault. Mirrors worker/src/jobs/vaultAutoFile.ts
-- (computeNextRevision / selectSupersedable / storage_path idempotency) in ONE transaction, serialised
-- per (folder, document reference) with an advisory lock. Idempotent: create or replace.

create or replace function public.vault_file_generated_document(
  p_folder_id uuid,
  p_title text,
  p_document_reference text,
  p_revision text,
  p_storage_path text,
  p_file_size bigint,
  p_status text,
  p_uploaded_by uuid,
  p_auto_revision boolean,
  p_keep_revision boolean
)
returns table (id uuid, revision text, already_filed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref text := coalesce(p_document_reference, p_title);
  v_status text := coalesce(p_status, 'approved');
  v_rev text := coalesce(p_revision, '0');
  v_existing_id uuid;
  v_existing_rev text;
  v_row_count int;
  v_max_numeric numeric;
  v_candidate bigint;
  v_new_id uuid;
  v_new_numeric bigint;
begin
  if v_status not in ('approved', 'for_review') then
    raise exception 'invalid status %', v_status;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_folder_id::text || v_ref));

  -- Idempotency: same stored object already filed.
  select d.id, d.revision into v_existing_id, v_existing_rev
  from public.vault_documents d
  where d.folder_id = p_folder_id and d.storage_path = p_storage_path
  limit 1;
  if found then
    return query select v_existing_id, v_existing_rev, true;
    return;
  end if;

  if not coalesce(p_keep_revision, false)
     and (coalesce(p_auto_revision, false)
          or exists (
            select 1 from public.vault_documents d
            where d.folder_id = p_folder_id and d.document_reference = v_ref
              and btrim(d.revision) = btrim(v_rev))) then
    select count(*), max(btrim(d.revision)::numeric) filter (where btrim(d.revision) ~ '^\d+$')
      into v_row_count, v_max_numeric
    from public.vault_documents d
    where d.folder_id = p_folder_id and d.document_reference = v_ref;

    if v_max_numeric is not null then
      v_candidate := v_max_numeric::bigint + 1;
    elsif v_row_count = 0 then
      v_candidate := 0;
    else
      v_candidate := v_row_count;
    end if;
    while exists (
      select 1 from public.vault_documents d
      where d.folder_id = p_folder_id and d.document_reference = v_ref
        and btrim(d.revision) = v_candidate::text
    ) loop
      v_candidate := v_candidate + 1;
    end loop;
    v_rev := v_candidate::text;
  end if;

  insert into public.vault_documents (
    folder_id, title, document_reference, revision, storage_path, file_size, status, uploaded_by
  ) values (
    p_folder_id, p_title, v_ref, v_rev, p_storage_path, p_file_size, v_status, p_uploaded_by
  )
  returning vault_documents.id into v_new_id;

  if v_status <> 'for_review' and btrim(v_rev) ~ '^\d+$' then
    v_new_numeric := btrim(v_rev)::bigint;
    update public.vault_documents d
       set status = 'superseded', superseded_by = v_new_id
     where d.folder_id = p_folder_id
       and d.document_reference = v_ref
       and d.id <> v_new_id
       and d.status = 'approved'
       and btrim(d.revision) ~ '^\d+$'
       and case when coalesce(p_keep_revision, false)
                then btrim(d.revision)::bigint <= v_new_numeric
                else btrim(d.revision)::bigint < v_new_numeric end;
  end if;

  return query select v_new_id, v_rev, false;
end;
$$;

revoke all on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) from public;
revoke all on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) from anon;
revoke all on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) from authenticated;
grant execute on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) to service_role;

-- NOTE: the unique partial index on (folder_id, document_reference, revision) is intentionally NOT created here.
