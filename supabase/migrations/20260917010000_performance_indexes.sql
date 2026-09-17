-- Round-table performance finding: a few hot filter/sort shapes weren't backed by a matching index.
-- background_jobs already has the composite (status, created_at) index the round table asked for
-- (background_jobs_status_idx) — confirmed via pg_indexes before writing this, not duplicated here.
-- These three are the actual gaps.

-- Dashboard "my pending NCRs" / overdue-NCR queries filter by assigned_to + status, sorted by
-- due_date — the existing ncrs_status_idx is status-only.
create index if not exists ncrs_assigned_to_status_due_date_idx
  on public.ncrs (assigned_to, status, due_date);

-- Hold-point checks (canCompleteInspection) and hold-point-turnaround aggregation both filter
-- activity_signoff_progress by intervention = 'H' and a status value — the existing
-- activity_signoff_progress_item_idx only covers itp_item_id.
create index if not exists activity_signoff_progress_intervention_status_idx
  on public.activity_signoff_progress (intervention, status);

-- Finding the in-progress/draft inspection_record for a checklist template (checklists/[id]/page.tsx's
-- draft-record lookup) filters by itp_item_id/checklist_template_id with overall_result IS NULL — a
-- partial index on the common "still open" case is far smaller and faster than a full-table scan as
-- volume grows, since most historical records have a non-null result.
create index if not exists inspection_records_open_idx
  on public.inspection_records (itp_item_id)
  where overall_result is null;
