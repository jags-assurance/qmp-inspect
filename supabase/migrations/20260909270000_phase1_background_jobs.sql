-- Phase 1: background job queue for work too heavy for a Vercel serverless function (Puppeteer's
-- Chromium binary + landscape A4 documents with repeating headers don't fit serverless
-- timeout/size limits well). A separate Node worker (Railway) polls this table and does the actual
-- rendering; the web app only ever inserts a row and polls its status.

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('render_itp_pdf')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  result_storage_path text,
  error_message text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index background_jobs_status_idx on public.background_jobs (status, created_at);

create trigger background_jobs_set_updated_at
  before update on public.background_jobs
  for each row execute function public.set_updated_at();

alter table public.background_jobs enable row level security;

-- Any authenticated user with org access can request a render; the worker (service role, which
-- bypasses RLS entirely) is the only writer that ever transitions status/result/error, so there is
-- no authenticated UPDATE policy at all here by design.
--
-- The check below is deliberately NOT `true`: the worker renders and uploads with the service-role
-- key regardless of the requester's access, so authorization has to happen here, at insert time —
-- otherwise any authenticated user could queue a render for an ITP belonging to an organisation
-- they have no access to, and the resulting PDF would still land in storage.
create policy background_jobs_insert on public.background_jobs
  for insert to authenticated
  with check (
    job_type <> 'render_itp_pdf'
    or exists (
      select 1 from public.itps i
      join public.projects p on p.id = i.project_id
      where i.id = (payload ->> 'itp_id')::uuid
        and public.has_org_access(p.organization_id)
    )
  );

-- A user can see the status of jobs they requested; JAGS staff can see every job (support/ops).
-- The payload always carries the requesting user under 'requested_by' (enforced by the web app,
-- same as other jsonb-payload jobs elsewhere in the schema) rather than a dedicated column, since
-- background_jobs is a generic queue shared by future job_types beyond render_itp_pdf.
create policy background_jobs_select on public.background_jobs
  for select to authenticated
  using (
    (payload ->> 'requested_by')::uuid = auth.uid()
    or public.is_jags_staff()
  );
