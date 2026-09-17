-- Per-organisation visual branding: lets a JAGS Admin override the fixed burgundy/gold theme with
-- two hex colors per client, without touching the worker's Puppeteer-rendered PDF templates (that
-- HTML has its own CSS and is deliberately out of scope for this pass — see
-- worker/src/jobs/*.ts). Nullable and defaulting to null: null means "use the default JAGS
-- burgundy/gold palette" (see apps/web/app/globals.css's :root block), not "no color".
--
-- Stored as plain hex strings (e.g. "#0f4c81") rather than a richer color type — this is a display
-- override for a handful of CSS custom properties, not a full design-token system, so a simple
-- format check is enough to catch a bad paste from a client email without over-engineering it.

alter table public.organizations add column brand_primary_color text;
alter table public.organizations add column brand_accent_color text;

alter table public.organizations add constraint organizations_brand_primary_color_hex_check
  check (brand_primary_color is null or brand_primary_color ~* '^#[0-9a-f]{6}$');

alter table public.organizations add constraint organizations_brand_accent_color_hex_check
  check (brand_accent_color is null or brand_accent_color ~* '^#[0-9a-f]{6}$');
