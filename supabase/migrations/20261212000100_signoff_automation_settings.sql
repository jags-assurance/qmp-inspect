-- Phase 2 automation: organisation-level switches for the routine sign-off plumbing.
-- NOT applied automatically; dev and prod share one database, so apply deliberately.
--
--   auto_notify_signoffs        When on, the next eligible Pending sign-off rows are notified
--                               automatically (ITP approved / client accepted, or a lower level cleared)
--                               instead of someone pressing Notify.
--   auto_proceed_after_notice   When on, a notified Witness (W) or Surveillance (S) row with no response
--                               after its notice period is marked 'proceeded_no_response' automatically.
--                               Never applies to a Hold (H) or Review (R), and never signs anything off.
--
-- Both default to false, so every existing organisation behaves exactly as before until an admin opts in.
-- The app falls back to "off" when these columns do not exist yet.
alter table public.organizations
  add column if not exists auto_notify_signoffs boolean not null default false,
  add column if not exists auto_proceed_after_notice boolean not null default false;
