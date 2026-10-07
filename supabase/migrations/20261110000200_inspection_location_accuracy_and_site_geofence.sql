-- S4-17: location accuracy and a soft site geofence on "start inspection". Idempotent, additive.
-- A project may carry site coordinates and a radius; when set, starting an inspection records how far
-- the inspector was from the site and whether that is inside the radius. It is a soft warning (shown
-- on the record and the start form), never a block: GPS is unreliable indoors and in shielded plant.

alter table public.projects
  add column if not exists site_latitude double precision,
  add column if not exists site_longitude double precision,
  add column if not exists site_radius_m integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_site_geofence_valid') then
    alter table public.projects
      add constraint projects_site_geofence_valid
      check (
        (site_latitude is null or site_latitude between -90 and 90)
        and (site_longitude is null or site_longitude between -180 and 180)
        and (site_radius_m is null or site_radius_m between 10 and 100000)
        and ((site_latitude is null) = (site_longitude is null))
      ) not valid;
  end if;
end $$;

alter table public.inspection_records
  add column if not exists location_accuracy_m numeric(10, 1),
  add column if not exists location_captured_at timestamptz,
  add column if not exists location_distance_m numeric(12, 1),
  add column if not exists location_geofence_status text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inspection_records_geofence_status_check') then
    alter table public.inspection_records
      add constraint inspection_records_geofence_status_check
      check (location_geofence_status is null or location_geofence_status in ('inside', 'outside', 'unknown', 'not_configured')) not valid;
  end if;
end $$;

comment on column public.projects.site_latitude is 'Optional site centre for the soft start-inspection geofence (S4-17).';
comment on column public.projects.site_radius_m is 'Soft geofence radius in metres around the site centre (S4-17).';
comment on column public.inspection_records.location_accuracy_m is 'Reported GPS accuracy (metres) when the live location was taken (S4-17).';
comment on column public.inspection_records.location_distance_m is 'Distance in metres from the project site centre at start (S4-17).';
comment on column public.inspection_records.location_geofence_status is 'inside | outside | unknown | not_configured, soft warning only (S4-17).';
