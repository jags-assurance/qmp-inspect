-- One APPROVED copy per (folder, document reference).
--
-- Why: two writers could each leave an approved copy behind (approve-then-supersede in the app,
-- insert-then-supersede in the generated-document filer), and nothing in the database stopped it, so a
-- document reference could have two "current" approved copies. This migration
--   1. adds vault_approve_document(): approve one document and retire the other copies of its reference
--      in ONE transaction, in the order the index needs (retire first, approve second);
--   2. re-creates vault_file_generated_document() with the same reordering;
--   3. adds the partial unique index, but ONLY if no reference currently has two approved copies. If any
--      do, it raises a NOTICE with the count and leaves the index out (nothing is changed or deleted);
--      resolve them with the query below and re-run this migration, which is idempotent.
--
--   select folder_id, document_reference, count(*), array_agg(id order by created_at)
--   from public.vault_documents where status = 'approved' and document_reference is not null
--   group by 1, 2 having count(*) > 1;
--
-- vault_approve_document is SECURITY INVOKER: the same RLS and approval guard triggers apply to the caller
-- as for the plain updates it replaces; the app still does its own permission and approver-list checks first.

create or replace function public.vault_approve_document(p_document_id uuid, p_approved_by uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_doc record;
  v_updated int;
begin
  select id, folder_id, document_reference, status into v_doc
  from public.vault_documents where id = p_document_id for update;
  if not found or v_doc.status <> 'for_review' then
    return false;
  end if;

  if v_doc.document_reference is not null then
    perform pg_advisory_xact_lock(hashtext(v_doc.folder_id::text || v_doc.document_reference));
    update public.vault_documents d
       set status = 'superseded'
     where d.folder_id = v_doc.folder_id
       and d.document_reference = v_doc.document_reference
       and d.id <> v_doc.id
       and d.status <> 'superseded';
  end if;

  update public.vault_documents d
     set status = 'approved', approved_by = p_approved_by, approved_at = now()
   where d.id = v_doc.id and d.status = 'for_review';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Document is no longer awaiting review' using errcode = '40001';
  end if;

  if v_doc.document_reference is not null then
    update public.vault_documents d
       set superseded_by = v_doc.id
     where d.folder_id = v_doc.folder_id
       and d.document_reference = v_doc.document_reference
       and d.id <> v_doc.id
       and d.status = 'superseded'
       and d.superseded_by is null;
  end if;
  return true;
end;
$$;

revoke all on function public.vault_approve_document(uuid, uuid) from public, anon;
grant execute on function public.vault_approve_document(uuid, uuid) to authenticated, service_role;

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
  v_stale uuid[];
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

  -- Reordered for the one-approved-copy-per-reference index: retire the copies this one replaces BEFORE it
  -- is inserted as approved, then point them at it. If an approved copy that this one does not replace
  -- remains (a higher or non-numeric revision), the new row is filed as 'superseded': an older or
  -- incomparable revision never displaces a current approved copy.
  if v_status = 'approved' then
    if btrim(v_rev) ~ '^\d+$' then
      v_new_numeric := btrim(v_rev)::bigint;
      select array_agg(d.id) into v_stale
      from public.vault_documents d
      where d.folder_id = p_folder_id
        and d.document_reference = v_ref
        and d.status = 'approved'
        and btrim(d.revision) ~ '^\d+$'
        and case when coalesce(p_keep_revision, false)
                 then btrim(d.revision)::bigint <= v_new_numeric
                 else btrim(d.revision)::bigint < v_new_numeric end;
      if v_stale is not null then
        update public.vault_documents d set status = 'superseded' where d.id = any (v_stale);
      end if;
    end if;
    if exists (
      select 1 from public.vault_documents d
      where d.folder_id = p_folder_id and d.document_reference = v_ref and d.status = 'approved'
    ) then
      v_status := 'superseded';
    end if;
  end if;

  insert into public.vault_documents (
    folder_id, title, document_reference, revision, storage_path, file_size, status, uploaded_by
  ) values (
    p_folder_id, p_title, v_ref, v_rev, p_storage_path, p_file_size, v_status, p_uploaded_by
  )
  returning vault_documents.id into v_new_id;

  if v_stale is not null then
    update public.vault_documents d set superseded_by = v_new_id where d.id = any (v_stale);
  end if;

  return query select v_new_id, v_rev, false;
end;
$$;

revoke all on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) from public;
revoke all on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) from anon;
revoke all on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) from authenticated;
grant execute on function public.vault_file_generated_document(uuid, text, text, text, text, bigint, text, uuid, boolean, boolean) to service_role;

do $$
begin
  if exists (
    select 1 from public.vault_documents
    where status = 'approved' and document_reference is not null
    group by folder_id, document_reference having count(*) > 1
  ) then
    raise notice 'vault_documents_one_approved_per_ref NOT created: some references already have more than one approved copy (see the query in this file). Nothing was changed.';
  else
    create unique index if not exists vault_documents_one_approved_per_ref
      on public.vault_documents (folder_id, document_reference)
      where status = 'approved' and document_reference is not null;
  end if;
end
$$;
