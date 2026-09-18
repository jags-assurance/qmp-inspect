-- Real timestamps for the few status transitions that had a "who" (reviewed_by/approved_by) but no
-- "when" — needed so the project Activity feed (app/inspect/projects/[projectId]/activity/page.tsx)
-- can show ITP review/approval, standalone assignment completion, and a sign-off "proceeded without
-- response" as real, timestamped events instead of either omitting them (the feed's previous stance,
-- per its own doc comment) or fabricating a time from an unrelated column like updated_at.

alter table public.itps
  add column reviewed_at timestamptz,
  add column approved_at timestamptz;

alter table public.standalone_assignments
  add column completed_at timestamptz;

alter table public.activity_signoff_progress
  add column proceeded_at timestamptz;
