-- Phase 3: adds the "generate_monthly_report_pack" background job type (R109 — monthly client
-- report pack, PDF + Excel/CSV, per organisation covering all their licensed services for one
-- calendar month). Follows the exact background_jobs -> Railway worker -> Storage upload pattern
-- already used by render_itp_pdf (20260909270000_phase1_background_jobs.sql) rather than a new
-- table or a new pipeline.
--
-- The existing background_jobs_insert policy's job_type <> 'render_itp_pdf' branch was written
-- before any second job_type existed, so it reads as "anything that isn't render_itp_pdf is
-- allowed unconditionally" — harmless while render_itp_pdf was the only job_type, but it would let
-- any authenticated user queue a report-pack render for any organisation once a second job_type is
-- added. This migration replaces the policy with an explicit branch per job_type instead of an
-- exclusion, so adding a future job_type here can no longer silently fall through unauthorised.

alter table public.background_jobs drop constraint background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in ('render_itp_pdf', 'generate_monthly_report_pack'));

drop policy background_jobs_insert on public.background_jobs;

-- Monthly report packs are Admin-staff work (see isAdminStaff() in apps/web/lib/auth/session.ts —
-- the numbering/organisation-settings screen this ships alongside is already Admin-only), gated
-- here at the DB layer with is_jags_staff() as the closest DB-level equivalent (an Inspector vs.
-- Admin split is a business permission enforced in the server action, same pattern as
-- updateEngagementModeAction in apps/web/lib/numbering/actions.ts) plus has_org_access() so a
-- staff login can only queue a pack for an organisation they actually have access to.
create policy background_jobs_insert on public.background_jobs
  for insert to authenticated
  with check (
    (
      job_type = 'render_itp_pdf'
      and exists (
        select 1 from public.itps i
        join public.projects p on p.id = i.project_id
        where i.id = (payload ->> 'itp_id')::uuid
          and public.has_org_access(p.organization_id)
      )
    )
    or (
      job_type = 'generate_monthly_report_pack'
      and public.is_jags_staff()
      and (payload ->> 'organization_id') is not null
      and public.has_org_access((payload ->> 'organization_id')::uuid)
    )
  );
