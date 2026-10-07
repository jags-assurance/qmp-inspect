import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/auth/app-url";
import { safeNextPath } from "@/lib/auth/safe-redirect";

// Lands here from the link in the password-reset email. Supabase's own /auth/v1/verify endpoint
// has already validated the recovery token before redirecting here with a PKCE `code` — this route
// only exchanges that code for a real session (setting the auth cookies), then forwards on to
// wherever the reset flow wants the user next (?next=/reset-password).
//
// `next` is attacker-controllable (it is a query parameter on an emailed link), so it is only ever
// used as a same-site path — `?next=@evil.example` would otherwise build https://app@evil.example —
// and the redirect base is the configured app URL, not the request's own origin.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/reset-password");
  const base = await getAppUrl();

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, base));
    }
  }

  return NextResponse.redirect(new URL("/login?error=reset_link_invalid", base));
}
