-- S6-18: document retention rules. Idempotent; additive. NOTHING IN THIS MIGRATION (or the worker sweep it
-- supports) DELETES, HIDES OR CHANGES A DOCUMENT. Retention only produces a review list.
--
--  1. org_retention_settings: one row per organisation with a retention period in years. Set and read
--     by JAGS staff only (writes: Admin staff with access to that organisation).
--  2. vault_retention_flags: the worker flags a vault document once it is older than its organisation's
--     retention period (the clock starts when the document was approved, or uploaded if it never was).
--     One row per document (the primary key makes flagging idempotent and a reviewed document is never
--     re-flagged). Readable by JAGS staff with project access. Written only by the service role (the
--     worker) and by review_retention_flag() below - there is no insert/update/delete policy.
--  3. retention_flag_candidates(org, cutoff, limit): service-role only helper for the worker; lists
--     documents of an organisation older than the cutoff that are not flagged yet (an anti-join, so a
--     flagged document drops out of later sweeps).
--  4. review_retention_flag(document, outcome, note): an Admin records the human decision on a flag:
--     'keep' (retain it; the flag stays as the record of the review) or 'dispose_approved' (disposal was
--     approved - the document is still not touched; whoever carries out the disposal does so outside
--     this system and the flag is the audit record).
--
-- Requires has_org_access(), has_project_access(), is_jags_staff(), is_admin_staff(). Does not edit earlier
-- migrations.

create table if not exists public.org_retention_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  retention_years integer not null check (retention_years between 1 and 100),
  enabled boolean not null default true,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_retention_settings enable row level security;

drop policy if exists org_retention_settings_select on public.org_retention_settings;
create policy org_retention_settings_select on public.org_retention_settings for select using (
  public.is_jags_staff() and public.has_org_access(organization_id)
);

drop policy if exists org_retention_settings_insert on public.org_retention_settings;
create policy org_retention_settings_insert on public.org_retention_settings for insert with check (
  public.is_admin_staff() and public.has_org_access(organization_id)
);

drop policy if exists org_retention_settings_update on public.org_retention_settings;
create policy org_retention_settings_update on public.org_retention_settings for update
  using (public.is_admin_staff() and public.has_org_access(organization_id))
  with check (public.is_admin_staff() and public.has_org_access(organization_id));

-- No delete policy: switch retention off with enabled = false instead.

create table if not exists public.vault_retention_flags (
  document_id uuid primary key references public.vault_documents (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The policy and dates in force when the flag was raised (a later change to the setting does not rewrite history).
  retention_years integer not null,
  reference_date date not null,
  due_on date not null,
  flagged_at timestamptz not null default now(),
  review_outcome text check (review_outcome in ('keep', 'dispose_approved')),
  review_note text check (review_note is null or length(review_note) <= 2000),
  reviewed_by uuid references public.users (id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists vault_retention_flags_org_idx on public.vault_retention_flags (organization_id, flagged_at desc);
create index if not exists vault_retention_flags_project_idx on public.vault_retention_flags (project_id);
create index if not exists vault_retention_flags_unreviewed_idx on public.vault_retention_flags (organization_id) where reviewed_at is null;

alter table public.vault_retention_flags enable row level security;

drop policy if exists vault_retention_flags_select on public.vault_retention_flags;
create policy vault_retention_flags_select on public.vault_retention_flags for select using (
  public.is_jags_staff() and public.has_project_access(project_id, organization_id)
);

create or replace function public.review_retention_flag(
  p_document_id uuid,
  p_outcome text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flag public.vault_retention_flags%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_admin_staff() then
    raise exception 'Only a JAGS Admin can review a retention flag';
  end if;
  if p_outcome not in ('keep', 'dispose_approved') then
    raise exception 'Unknown retention review outcome';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'The review note is too long';
  end if;

  select * into v_flag from public.vault_retention_flags where document_id = p_document_id for update;
  if not found then
    raise exception 'This document is not flagged for retention review';
  end if;
  if not public.has_project_access(v_flag.project_id, v_flag.organization_id) then
    raise exception 'No access to this project';
  end if;
  if p_outcome = 'dispose_approved' and v_note is null then
    raise exception 'A note is required when approving disposal';
  end if;

  update public.vault_retention_flags
     set review_outcome = p_outcome, review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
   where document_id = p_document_id;
end;
$$;

revoke all on function public.review_retention_flag(uuid, text, text) from public, anon;
grant execute on function public.review_retention_flag(uuid, text, text) to authenticated, service_role;

create or replace function public.retention_flag_candidates(
  p_organization_id uuid,
  p_created_before timestamptz,
  p_limit integer default 500
)
returns table (id uuid, project_id uuid, created_at timestamptz, approved_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, f.project_id, d.created_at, d.approved_at
  from public.vault_documents d
    join public.vault_folders f on f.id = d.folder_id
    join public.projects p on p.id = f.project_id
  where p.organization_id = p_organization_id
    and d.created_at <= p_created_before
    and (d.approved_at is null or d.approved_at <= p_created_before)
    and not exists (select 1 from public.vault_retention_flags r where r.document_id = d.id)
  order by d.created_at, d.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.retention_flag_candidates(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.retention_flag_candidates(uuid, timestamptz, integer) to service_role;

comment on table public.vault_retention_flags is
  'Documents past their organisation''s retention period, flagged for human review (S6-18). Never deletes or hides a document.';
