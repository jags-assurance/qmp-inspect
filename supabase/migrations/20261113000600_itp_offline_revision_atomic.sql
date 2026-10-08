-- S2-09: applying an offline-edited ITP workbook is all-or-nothing, and refuses a stale file.
-- Before this, the app applied the file as dozens of separate writes, ignored most errors (a failure half way
-- left the ITP half-changed) and re-read the ITP right before writing, so a colleague's edit made after the
-- preview was silently overwritten. Now:
--   * itp_content_token() fingerprints an ITP's sections and activities; the preview step records it.
--   * apply_itp_offline_revision() re-checks the fingerprint INSIDE the same transaction as the writes and
--     raises if the ITP changed since the preview; any error rolls the whole change back.
-- SECURITY INVOKER: the caller's own RLS and the existing ITP write guards still apply to every statement.
-- Idempotent.
create or replace function public.itp_content_token(p_itp_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select md5(coalesce(string_agg(
    s.section_number::text || '|' || s.title || '|' || coalesce(i.item_number, '') || '|' || coalesce(i.activity, '') || '|' ||
    coalesce(i.acceptance_criteria, '') || '|' || coalesce(i.evidence_type::text, '') || '|' ||
    coalesce(i.discipline_id::text, '') || '|' || coalesce(i.sort_order::text, ''),
    E'\n' order by s.section_number, i.sort_order, i.item_number
  ), ''))
  from public.itp_sections s
  left join public.itp_items i on i.section_id = s.id
  where s.itp_id = p_itp_id;
$$;

create or replace function public.apply_itp_offline_revision(p_itp_id uuid, p_rows jsonb, p_base_token text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_secnum int;
  v_title text;
  v_section_id uuid;
  v_next_sort int;
  v_existing_id uuid;
  v_row jsonb;
  v_idx int;
  v_disc uuid;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The uploaded file had no activity rows to apply.' using errcode = 'P0001';
  end if;
  if p_base_token is not null and p_base_token <> public.itp_content_token(p_itp_id) then
    raise exception 'This ITP changed after the file was checked. Upload the file again to see the current differences.' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from public.itp_sections where itp_id = p_itp_id;

  -- Sections: update the title of existing ones, add new ones (title taken from the section's first row).
  for v_secnum, v_title in
    select distinct on (sec) sec, ttl
    from (
      select (e ->> 'sectionNumber')::int as sec, e ->> 'sectionTitle' as ttl, ord
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
    ) x
    order by sec, ord
  loop
    select id into v_existing_id from public.itp_sections where itp_id = p_itp_id and section_number = v_secnum;
    if v_existing_id is null then
      insert into public.itp_sections (itp_id, section_number, title, sort_order)
      values (p_itp_id, v_secnum, v_title, v_next_sort);
      v_next_sort := v_next_sort + 1;
    else
      update public.itp_sections set title = v_title where id = v_existing_id and title is distinct from v_title;
    end if;
  end loop;

  -- Sections that are not in the file go (their activities cascade).
  delete from public.itp_sections s
   where s.itp_id = p_itp_id
     and not exists (
       select 1 from jsonb_array_elements(p_rows) e where (e ->> 'sectionNumber')::int = s.section_number
     );

  -- Activities: update by (section, item number) or insert, in file order within each section.
  for v_row, v_idx in
    select e, (row_number() over (partition by (e ->> 'sectionNumber')::int order by ord) - 1)::int
    from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
    order by ord
  loop
    select id into v_section_id from public.itp_sections
     where itp_id = p_itp_id and section_number = (v_row ->> 'sectionNumber')::int;
    select id into v_disc from public.master_disciplines where code = nullif(v_row ->> 'disciplineCode', '') limit 1;
    select id into v_existing_id from public.itp_items where section_id = v_section_id and item_number = v_row ->> 'itemNumber';

    if v_existing_id is null then
      insert into public.itp_items (section_id, item_number, activity, acceptance_criteria, evidence_type, discipline_id, sort_order)
      values (
        v_section_id, v_row ->> 'itemNumber', v_row ->> 'activity', nullif(v_row ->> 'acceptanceCriteria', ''),
        (v_row ->> 'evidenceType')::int, v_disc, v_idx
      );
    else
      update public.itp_items
         set activity = v_row ->> 'activity',
             acceptance_criteria = nullif(v_row ->> 'acceptanceCriteria', ''),
             evidence_type = (v_row ->> 'evidenceType')::int,
             discipline_id = v_disc,
             sort_order = v_idx
       where id = v_existing_id;
    end if;
  end loop;

  -- Activities that are not in the file go.
  delete from public.itp_items i
   using public.itp_sections s
   where i.section_id = s.id
     and s.itp_id = p_itp_id
     and not exists (
       select 1 from jsonb_array_elements(p_rows) e
        where (e ->> 'sectionNumber')::int = s.section_number and e ->> 'itemNumber' = i.item_number
     );
end;
$$;

revoke all on function public.itp_content_token(uuid) from public, anon;
grant execute on function public.itp_content_token(uuid) to authenticated;
revoke all on function public.apply_itp_offline_revision(uuid, jsonb, text) from public, anon;
grant execute on function public.apply_itp_offline_revision(uuid, jsonb, text) to authenticated;
