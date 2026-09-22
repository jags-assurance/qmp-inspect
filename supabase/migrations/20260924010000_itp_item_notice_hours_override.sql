-- R25: notification period was configurable per-project/per-intervention-level
-- (notice_period_configs / intervention_level_types.default_notice_hours — see
-- lib/signoff/actions.ts's getNoticePeriodHours) but never per-activity. This adds the top tier of
-- that precedence chain: an optional, per-item override that wins over the project/org/built-in
-- fallback when set. Nullable so every existing item keeps today's resolution unchanged until an
-- inspector deliberately sets one.
alter table public.itp_items
  add column notice_hours_override int;

comment on column public.itp_items.notice_hours_override is
  'R25: optional per-activity override of how many hours'' notice a party gets before "proceed without response" is allowed for a sign-off on this item. Null (the default) falls back to the existing project/org/built-in resolution in lib/signoff/actions.ts''s getNoticePeriodHours.';
