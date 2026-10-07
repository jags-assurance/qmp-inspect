/**
 * Pure helpers for the cached organisation chrome (chrome-cache.ts), split out so they can be unit
 * tested without Next's cache runtime.
 */
export function orgChromeTag(organizationId: string): string {
  return `org-chrome:${organizationId}`;
}

/** Whether the app chrome should show the org's own logo (a JAGS-led org always stays JAGS-branded). */
export function wantsLogo(row: { engagement_mode: string; branding_logo_path: string | null }): boolean {
  return row.engagement_mode !== "jags_led" && !!row.branding_logo_path;
}
