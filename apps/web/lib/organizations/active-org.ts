// Which organisation a client login is "working in". A user can hold grants in several organisations;
// nav, branding and licensing follow ONE of them. Default is the first organisation grant (the
// historical behaviour); a cookie can choose another, but only if the user really holds a grant there.
// Pure (no next/headers) so it unit-tests cleanly.

export const ACTIVE_ORG_COOKIE = "qmp_active_org";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct organisation ids across grants, in grant order. */
export function grantedOrgIds(grants: { organization_id: string | null }[]): string[] {
  const out: string[] = [];
  for (const g of grants) if (g.organization_id && !out.includes(g.organization_id)) out.push(g.organization_id);
  return out;
}

/** The chosen org if the user holds a grant there, else the first granted org, else null. */
export function resolveActiveOrgId(grants: { organization_id: string | null }[], cookieValue: string | null | undefined): string | null {
  const ids = grantedOrgIds(grants);
  const wanted = cookieValue?.trim();
  if (wanted && UUID.test(wanted)) {
    const hit = ids.find((id) => id.toLowerCase() === wanted.toLowerCase());
    if (hit) return hit;
  }
  return ids[0] ?? null;
}
