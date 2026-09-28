-- Real feedback from a client demo: the just-shipped 4-color combo (20260930120000) was fixed at
-- exactly 4 colors — the client wants ANY number of custom colors in the combo, not a hardcoded
-- count. Replaces the two fixed color_3/color_4 columns with a variable-length array: the combo is
-- [brand_primary_color, brand_accent_color, ...brand_extra_colors], so an org can add as many extra
-- swatches as it wants (or remove down to zero, which just falls back to the plain 2-color look).
alter table public.organizations drop column if exists brand_color_3;
alter table public.organizations drop column if exists brand_color_4;

alter table public.organizations add column brand_extra_colors text[] not null default '{}';

-- No DB-level per-element check: Postgres CHECK constraints can't contain a subquery (which
-- unnest()-ing an array into a per-row check requires), so hex validation for this array lives
-- entirely at the app layer (lib/branding/actions.ts's HEX_COLOR_RE test on each element before
-- insert) — same "app layer is the real gate" pattern this codebase already documents elsewhere
-- for constraints RLS/DDL can't express.
