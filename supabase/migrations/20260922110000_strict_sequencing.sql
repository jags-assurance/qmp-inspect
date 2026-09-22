-- R67: configurable strict vs. flexible party-chain sequencing per organisation.
--
-- findUnclearedLowerBlockingLevel (apps/web/lib/signoff/actions.ts) already enforces that every
-- BLOCKING intervention level with a lower sort_order must clear before a blocking level can be
-- signed off (R101/R102 hierarchical sequencing). That hierarchy has only ever applied among
-- blocking levels — two parties both holding non-blocking levels (e.g. Witness and Review) on the
-- same activity can sign in any order today, with no way to configure otherwise.
--
-- itp_sequencing_mode makes that configurable, org-wide (mirrors how engagement_scope/
-- engagement_mode are already org-level toggles, not per-activity):
--   'flexible' (default) — today's exact existing behaviour: only blocking levels enforce
--                           sort_order among themselves; non-blocking levels are free-for-all.
--   'strict'              — EVERY level (blocking or not) must be signed off in sort_order order.
--
-- Strictly additive: every existing org defaults to 'flexible', so this changes nothing until an
-- org's admin deliberately switches it.
alter table public.organizations
  add column itp_sequencing_mode text not null default 'flexible'
    check (itp_sequencing_mode in ('flexible', 'strict'));
