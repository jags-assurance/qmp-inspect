import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { orgChromeTag, wantsLogo } from "./chrome-logic";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * D-07: the slow-changing organisation fields the /inspect layout needs on every navigation for a
 * client login (engagement mode/scope for the nav, branding colours + logo for the chrome), plus the
 * signed logo URL (a Storage round trip on every page load before this). Cached 2 minutes, tagged
 * per organisation, and invalidated by revalidateTag(orgChromeTag(id)) from the branding and
 * numbering/engagement actions that write these columns.
 *
 * Read with the service-role client for the reason given in lib/master-disciplines/cache.ts (a cached
 * function cannot depend on one request's cookies); the organisation id is always the caller's own
 * org from their access grants. The logo URL is signed for an hour, far longer than the cache lives.
 * Returns null when it cannot answer so the caller falls back to the RLS-scoped read.
 */
export interface OrgChromeRow {
  engagement_mode: string;
  engagement_scope: string | null;
  branding_logo_path: string | null;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  brand_extra_colors: string[];
  brand_multi_color_mode: boolean;
}

export interface OrgChrome {
  row: OrgChromeRow;
  /** Signed URL for the org logo, only for a non-JAGS-led org that has one. */
  logoUrl: string | null;
}

const COLUMNS =
  "engagement_mode, engagement_scope, branding_logo_path, brand_primary_color, brand_accent_color, brand_extra_colors, brand_multi_color_mode";
const ORG_BRANDING_BUCKET = "org-branding";
const LOGO_URL_TTL_SECONDS = 3600;

const loadCached = (organizationId: string) =>
  unstable_cache(
    async (): Promise<OrgChrome | null> => {
      const supabase = createSupabaseServiceRoleClient();
      const { data, error } = await supabase
        .from("organizations")
        .select(COLUMNS)
        .eq("id", organizationId)
        .maybeSingle<OrgChromeRow>();
      if (error) throw new Error(`org chrome read failed: ${error.message}`);
      if (!data) return null;
      let logoUrl: string | null = null;
      if (wantsLogo(data)) {
        const { data: signed } = await supabase.storage.from(ORG_BRANDING_BUCKET).createSignedUrl(data.branding_logo_path!, LOGO_URL_TTL_SECONDS);
        logoUrl = signed?.signedUrl ?? null;
      }
      return { row: data, logoUrl };
    },
    ["org-chrome", organizationId],
    { revalidate: 120, tags: [orgChromeTag(organizationId)] }
  )();

const getCachedOrgChrome = cache(async (organizationId: string): Promise<{ answered: boolean; value: OrgChrome | null }> => {
  if (!isServiceRoleConfigured()) return { answered: false, value: null };
  try {
    return { answered: true, value: await loadCached(organizationId) };
  } catch {
    return { answered: false, value: null };
  }
});

/**
 * The org's chrome fields + logo URL: from the shared cache when it can answer, otherwise straight
 * from the caller's RLS-scoped client (the pre-cache behaviour).
 */
export async function loadOrgChrome(supabase: SupabaseClient, organizationId: string): Promise<OrgChrome | null> {
  const cached = await getCachedOrgChrome(organizationId);
  if (cached.answered) return cached.value;

  const { data } = await supabase.from("organizations").select(COLUMNS).eq("id", organizationId).maybeSingle<OrgChromeRow>();
  if (!data) return null;
  let logoUrl: string | null = null;
  if (wantsLogo(data)) {
    const { data: signed } = await supabase.storage.from(ORG_BRANDING_BUCKET).createSignedUrl(data.branding_logo_path!, LOGO_URL_TTL_SECONDS);
    logoUrl = signed?.signedUrl ?? null;
  }
  return { row: data, logoUrl };
}
