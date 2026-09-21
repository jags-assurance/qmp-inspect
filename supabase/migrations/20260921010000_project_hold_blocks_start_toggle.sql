-- Makes the "Hold blocks starting field work" behaviour (20260921000000 session's fix for R71 —
-- previously a Hold only blocked completeInspectionCore, not startInspectionAction) an admin-
-- configurable per-project setting instead of a hardwired global rule. Default true: R71 itself
-- ("a hold point must wait") is the written requirement, so the strict behaviour is what a new
-- project gets unless a JAGS Admin deliberately opts it out for a project whose process doesn't
-- need the stricter start-time gate — same "admin-configurable, off by default is not the safe
-- default here" reasoning as the other per-project toggles this session already uses (compare
-- allow_client_execution/allow_client_itp_creation, both default false because THEY widen who can
-- act; this one instead defaults to the stricter/compliant behaviour and lets admin loosen it).
alter table public.projects
  add column enforce_hold_blocks_start boolean not null default true;
