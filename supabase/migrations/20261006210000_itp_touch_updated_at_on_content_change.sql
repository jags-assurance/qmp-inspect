-- Any change to an ITP's sections, activities, sign-off levels or review steps must move itps.updated_at, so the
-- "PDF is out of date" check (which compares it with the PDF's completion time) notices it.
create or replace function public.touch_itp_updated_at()
returns trigger language plpgsql as $$
declare
  v_itp_id uuid;
  v_row record;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'itp_sections' or tg_table_name = 'itp_review_progress' then
    v_itp_id := v_row.itp_id;
  elsif tg_table_name = 'itp_items' then
    select s.itp_id into v_itp_id from public.itp_sections s where s.id = v_row.section_id;
  elsif tg_table_name = 'activity_party_intervention' then
    select s.itp_id into v_itp_id
      from public.itp_items i join public.itp_sections s on s.id = i.section_id
      where i.id = v_row.itp_item_id;
  end if;
  if v_itp_id is not null then
    update public.itps set updated_at = now() where id = v_itp_id and updated_at is distinct from now();
  end if;
  return null;
end;
$$;

drop trigger if exists itp_sections_touch_itp on public.itp_sections;
create trigger itp_sections_touch_itp after insert or update or delete on public.itp_sections
  for each row execute function public.touch_itp_updated_at();
drop trigger if exists itp_items_touch_itp on public.itp_items;
create trigger itp_items_touch_itp after insert or update or delete on public.itp_items
  for each row execute function public.touch_itp_updated_at();
drop trigger if exists activity_party_intervention_touch_itp on public.activity_party_intervention;
create trigger activity_party_intervention_touch_itp after insert or update or delete on public.activity_party_intervention
  for each row execute function public.touch_itp_updated_at();
drop trigger if exists itp_review_progress_touch_itp on public.itp_review_progress;
create trigger itp_review_progress_touch_itp after insert or update or delete on public.itp_review_progress
  for each row execute function public.touch_itp_updated_at();
