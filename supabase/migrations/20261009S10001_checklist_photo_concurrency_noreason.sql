-- S1: checklist execution hardening.
--  * checklist_responses: updated_at/updated_by (concurrent-edit detection) + no_ncr_reason
--    (written reason for a "No" answer when no NCR/observation was raised).
--  * inspection_photos: DB-level guard (path must sit under the record's project/record folder;
--    no insert/update/delete once the inspection is completed).
--  * storage.objects: DELETE policy for inspection-evidence project paths (none existed).

alter table public.checklist_responses
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id),
  add column if not exists no_ncr_reason text;

create or replace function public.checklist_responses_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists checklist_responses_touch on public.checklist_responses;
create trigger checklist_responses_touch
  before insert or update on public.checklist_responses
  for each row execute function public.checklist_responses_touch();

create or replace function public.inspection_photos_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec_id uuid := coalesce(new.inspection_record_id, old.inspection_record_id);
  r record;
begin
  select project_id, overall_result into r from public.inspection_records where id = rec_id;
  if r.project_id is null then
    return coalesce(new, old);
  end if;
  if r.overall_result is not null then
    -- Completed inspections are locked (a cascade delete of the record finds no record above).
    raise exception 'Inspection is completed; photos can no longer be changed' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.storage_path not like (r.project_id::text || '/' || rec_id::text || '/%') then
      raise exception 'Photo storage path does not belong to this inspection' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists inspection_photos_guard on public.inspection_photos;
create trigger inspection_photos_guard
  before insert or update or delete on public.inspection_photos
  for each row execute function public.inspection_photos_guard();

drop policy if exists inspection_evidence_delete on storage.objects;
create policy inspection_evidence_delete on storage.objects for delete using (
  bucket_id = 'inspection-evidence'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(objects.name))[1]
      and has_org_access(p.organization_id)
  )
);
