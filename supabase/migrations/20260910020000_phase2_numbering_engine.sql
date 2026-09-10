-- Phase 2: numbering engine, unified with organizations.engagement_mode (added in Phase 0).
-- One org-level setting drives both branding (engagement_mode, already existed) and document
-- numbering: a 'white_label' engagement needs the client-visible document number to carry no JAGS
-- branding, while JAGS still needs an internal traceability reference for its own QA records. That
-- internal reference is generated here alongside the visible number, never derived from it later.

create table public.numbering_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Null = org-level default for this doc_type, applied to every project of that org that has no
  -- project-specific override. See lib/numbering/generate.ts for the lookup order.
  project_id uuid references public.projects (id) on delete cascade,
  doc_type text not null check (doc_type in (
    'itp', 'ncr', 'checklist', 'irn', 'standalone_assignment', 'vault_document'
  )),
  client_code text not null,
  originator_code text not null default 'JAGS',
  separator text not null default '-',
  sequence_padding int not null default 3,
  include_year boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, doc_type)
);

create index numbering_configs_organization_id_idx on public.numbering_configs (organization_id);

create trigger numbering_configs_set_updated_at
  before update on public.numbering_configs
  for each row execute function public.set_updated_at();

-- document_sequences: one running counter per (organization, project, doc_type). project_id is
-- nullable for the same reason as above (an org-level counter shared by every project of that org
-- that has no project-specific config) — but a plain `unique (organization_id, project_id,
-- doc_type)` doesn't collapse multiple NULL-project_id rows for the same org+doc_type, because
-- Postgres treats NULLs as distinct for uniqueness purposes. Rather than invent a sentinel UUID
-- (which would need to be kept out of the real projects table forever), two partial unique indexes
-- are used instead — the same technique already used for access_grants' scope-shaped uniqueness in
-- Phase 0 (access_grants_one_per_org_per_user etc.), so it matches an existing convention rather
-- than introducing a new one.
create table public.document_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  -- White-label internal traceability sequences are kept in this same table, distinguished by a
  -- 'internal:' prefix on doc_type (e.g. 'internal:itp') so they never collide with a real
  -- project's counter for the same doc_type — see next_document_sequence's doc_type parameter.
  doc_type text not null,
  current_number int not null default 0,
  updated_at timestamptz not null default now()
);

create unique index document_sequences_with_project_uidx
  on public.document_sequences (organization_id, project_id, doc_type)
  where project_id is not null;

create unique index document_sequences_org_level_uidx
  on public.document_sequences (organization_id, doc_type)
  where project_id is null;

create index document_sequences_organization_id_idx on public.document_sequences (organization_id);

-- Atomic "get the next number" primitive. SECURITY DEFINER so it can be granted to authenticated
-- users via GRANT EXECUTE without also granting them direct INSERT/UPDATE on document_sequences —
-- the table itself carries no user-facing write policy at all (see below), specifically so a
-- regular user can never set their own sequence value by hand, only ever advance it by one via
-- this function. A single INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING is what makes the
-- increment race-free; the JS client's query builder cannot express an atomic upsert-with-returning
-- in one round trip, which is why this had to live in SQL rather than in generate.ts.
create or replace function public.next_document_sequence(
  org_id uuid,
  proj_id uuid,
  seq_doc_type text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value int;
begin
  if proj_id is null then
    insert into public.document_sequences (organization_id, project_id, doc_type, current_number)
    values (org_id, null, seq_doc_type, 1)
    on conflict (organization_id, doc_type) where project_id is null
    do update set current_number = document_sequences.current_number + 1,
                  updated_at = now()
    returning current_number into next_value;
  else
    insert into public.document_sequences (organization_id, project_id, doc_type, current_number)
    values (org_id, proj_id, seq_doc_type, 1)
    on conflict (organization_id, project_id, doc_type) where project_id is not null
    do update set current_number = document_sequences.current_number + 1,
                  updated_at = now()
    returning current_number into next_value;
  end if;

  return next_value;
end;
$$;

alter table public.numbering_configs enable row level security;
alter table public.document_sequences enable row level security;

create policy numbering_configs_select on public.numbering_configs
  for select using (public.has_org_access(organization_id));

-- Numbering formats are an organisational/admin concern (client codes, padding, separators) —
-- staff-only to change, same boundary as organizations_staff_write.
create policy numbering_configs_staff_write on public.numbering_configs
  for all using (public.is_jags_staff()) with check (public.is_jags_staff());

create policy document_sequences_select on public.document_sequences
  for select using (public.has_org_access(organization_id));

-- Deliberately no insert/update/delete policy here at all: the only sanctioned way to advance a
-- sequence is next_document_sequence(), which runs SECURITY DEFINER and so bypasses RLS on this
-- table entirely. Any authenticated user can safely be granted EXECUTE on that function without
-- being able to edit a counter directly (skip numbers, roll one back, etc.) through the client.
grant execute on function public.next_document_sequence(uuid, uuid, text) to authenticated;
