-- CEO-level strategy review flagged the Railway worker as a real operational risk: nothing stops
-- one organisation from queuing an unbounded burst of render jobs and starving every other org's
-- reports behind them in the shared background_jobs FIFO queue (see worker/src/index.ts's
-- claim-oldest-pending loop). This adds a per-organisation cap: at most 5 jobs may be
-- 'pending'/'processing' for the same org at once; a 6th insert is rejected with a clear message.
--
-- Implemented as a single BEFORE INSERT trigger on background_jobs rather than four separate
-- app-layer checks in apps/web/lib/reports/actions.ts, because:
--   1. Organisation resolution already differs per job_type (itp_id -> projects, organization_id
--      directly, inspection_record_id -> projects, assignment_id -> projects) and that branching
--      already lives in SQL, duplicated identically across background_jobs_insert /
--      background_jobs_select (see 20260916160000_portfolio_summary_pdf_job.sql). Mirroring it here
--      reuses the same shape instead of re-deriving it in TypeScript a third time.
--   2. A DB-level trigger is one enforcement point that also covers any future caller (a new job
--      type, an admin script, a future API route) automatically, instead of relying on every new
--      server action remembering to call a shared helper.
--   3. It needs no new infrastructure — still Postgres-as-queue, same as the rest of this table.
--
-- render_portfolio_summary_pdf is intentionally exempt: it has no organization_id/project_id (see
-- that migration's own header comment — it is portfolio-wide and is_jags_staff()-gated already),
-- so there is no "same organisation" to rate-limit against.
--
-- SECURITY DEFINER: the count must see every job for the org, not just rows the inserting user's
-- own RLS SELECT visibility would allow (a non-staff user can't see other users' jobs per
-- background_jobs_select), otherwise the cap could be silently under-counted per-user rather than
-- enforced per-org. search_path is pinned for the usual SECURITY DEFINER hardening reason.

create or replace function public.background_jobs_resolve_org_id(p_job_type text, p_payload jsonb)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p_job_type
    when 'render_itp_pdf' then (
      select p.organization_id from public.itps i join public.projects p on p.id = i.project_id
      where i.id = (p_payload ->> 'itp_id')::uuid
    )
    when 'generate_monthly_report_pack' then (p_payload ->> 'organization_id')::uuid
    when 'render_inspection_report_pdf' then (
      select p.organization_id from public.inspection_records r join public.projects p on p.id = r.project_id
      where r.id = (p_payload ->> 'inspection_record_id')::uuid
    )
    when 'render_fat_report_pdf' then (
      select p.organization_id from public.standalone_assignments a join public.projects p on p.id = a.project_id
      where a.id = (p_payload ->> 'assignment_id')::uuid
    )
    else null
  end;
$$;

create or replace function public.enforce_background_jobs_org_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_active_count int;
begin
  v_org_id := public.background_jobs_resolve_org_id(new.job_type, new.payload);

  -- No resolvable org (portfolio summary, or a malformed payload another check will reject anyway)
  -- -> nothing to rate-limit against.
  if v_org_id is null then
    return new;
  end if;

  select count(*) into v_active_count
  from public.background_jobs bj
  where bj.status in ('pending', 'processing')
    and public.background_jobs_resolve_org_id(bj.job_type, bj.payload) = v_org_id;

  if v_active_count >= 5 then
    raise exception 'Too many reports are already queued for your organisation — wait for one to finish before requesting another.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists background_jobs_org_rate_limit on public.background_jobs;
create trigger background_jobs_org_rate_limit
  before insert on public.background_jobs
  for each row execute function public.enforce_background_jobs_org_rate_limit();
