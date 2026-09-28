-- Extends 20260917060000_org_brand_colors.sql's plain 2-color (primary/accent) override with an
-- optional 4-color combo, the way Microsoft's logo (4 solid quadrant colors) or Google/Gemini's mark
-- (a multi-color gradient) work — a real request from the client demo round-table. Deliberately
-- additive: brand_multi_color_mode defaults to false, so every existing org keeps today's exact
-- 2-color look with zero behavior change unless an org explicitly opts in.
alter table public.organizations add column brand_color_3 text;
alter table public.organizations add column brand_color_4 text;
alter table public.organizations add column brand_multi_color_mode boolean not null default false;

alter table public.organizations add constraint organizations_brand_color_3_hex_check
  check (brand_color_3 is null or brand_color_3 ~* '^#[0-9a-f]{6}$');

alter table public.organizations add constraint organizations_brand_color_4_hex_check
  check (brand_color_4 is null or brand_color_4 ~* '^#[0-9a-f]{6}$');
