-- NCR workflow guard at the database layer. The original ncrs_write policy lets anyone with org
-- access update any column, so a crafted client request could close an NCR without CAPA, bypass
-- verification or edit a closed record. This trigger enforces the rules the app already applies.
-- Documents (Document Vault files) linked to an NCR as evidence.
create table if not exists public.ncr_documents (
  id uuid primary key default gen_random_uuid(),
  ncr_id uuid not null references public.ncrs (id) on delete cascade,
  vault_document_id uuid not null references public.vault_documents (id) on delete restrict,
  linked_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (ncr_id, vault_document_id)
);
create index if not exists ncr_documents_ncr_idx on public.ncr_documents (ncr_id);
alter table public.ncr_documents enable row level security;

drop policy if exists ncr_documents_select on public.ncr_documents;
create policy ncr_documents_select on public.ncr_documents for select using (
  exists (select 1 from public.ncrs n join public.projects p on p.id = n.project_id where n.id = ncr_documents.ncr_id and has_project_access(p.id, p.organization_id))
);
drop policy if exists ncr_documents_write on public.ncr_documents;
create policy ncr_documents_write on public.ncr_documents for all using (
  exists (select 1 from public.ncrs n join public.projects p on p.id = n.project_id where n.id = ncr_documents.ncr_id and has_project_access(p.id, p.organization_id))
) with check (
  exists (select 1 from public.ncrs n join public.projects p on p.id = n.project_id where n.id = ncr_documents.ncr_id and has_project_access(p.id, p.organization_id))
);

create or replace function public.ncrs_enforce_workflow()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- A closed NCR is immutable except for a re-open by JAGS staff.
    if old.status = 'closed' and new.status <> 'open' and new.status <> 'in_progress' then
      raise exception 'Closed NCR cannot be modified';
    end if;
    if old.status = 'closed' and new.status in ('open', 'in_progress') and not public.is_jags_staff() then
      raise exception 'Only JAGS staff can re-open an NCR';
    end if;

    if new.status = 'closed' and old.status <> 'closed' then
      if not public.is_jags_staff() then
        raise exception 'Only JAGS staff can close an NCR';
      end if;
      if old.status <> 'pending_verification' then
        raise exception 'NCR must be pending verification before closing';
      end if;
      if coalesce(btrim(new.root_cause), '') = '' or coalesce(btrim(new.corrective_action), '') = ''
         or coalesce(btrim(new.preventive_action), '') = '' or coalesce(btrim(new.verification_notes), '') = '' then
        raise exception 'Root cause, corrective action, preventive action and verification notes are required to close';
      end if;
      if old.raised_by is not null and old.raised_by = auth.uid() and not public.is_admin_staff() then
        raise exception 'The person who raised an NCR cannot close it';
      end if;
      if not exists (select 1 from public.ncr_photos where ncr_id = new.id)
         and not exists (select 1 from public.ncr_documents where ncr_id = new.id) then
        raise exception 'At least one evidence photo or linked document is required to close';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ncrs_enforce_workflow on public.ncrs;
create trigger ncrs_enforce_workflow
  before update on public.ncrs
  for each row execute function public.ncrs_enforce_workflow();
