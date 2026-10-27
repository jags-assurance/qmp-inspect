-- ITP detail page: a few lookups had no supporting index, and one row policy repeated its own check.
-- Written but not applied here: review, then apply with the usual migration run.

-- 1. The page looks up the latest PDF job for one ITP by payload->>'itp_id'. Only (status, created_at)
--    was indexed, so every view scanned the whole job table.
create index if not exists background_jobs_render_itp_pdf_itp_idx
  on public.background_jobs ((payload ->> 'itp_id'), created_at desc)
  where job_type = 'render_itp_pdf';

-- 2. "Was this ITP made from an AI draft?" filters the usage log by feature + target; no index covered target_id.
create index if not exists ai_usage_log_itp_draft_target_idx
  on public.ai_usage_log (target_id)
  where feature = 'itp_draft' and target_type = 'itp';

-- 3. activity_signoff_progress_select ORed the same EXISTS (four-table join + has_project_access) with itself,
--    so every sign-off row was checked twice. One copy gives the same rows.
drop policy if exists activity_signoff_progress_select on public.activity_signoff_progress;
create policy activity_signoff_progress_select on public.activity_signoff_progress
  for select using (
    exists (
      select 1
      from public.itp_items it
      join public.itp_sections s on s.id = it.section_id
      join public.itps i on i.id = s.itp_id
      join public.projects p on p.id = i.project_id
      where it.id = activity_signoff_progress.itp_item_id
        and public.has_project_access(p.id, p.organization_id)
    )
  );
