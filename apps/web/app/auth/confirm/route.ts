import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lands here from the link in the password-reset email. Supabase's own /auth/v1/verify endpoint
// has already validated the recovery token before redirecting here with a PKCE `code` — this route
// only exchanges that code for a real session (setting the auth cookies), then forwards on to
// wherever the reset flow wants the user next (?next=/reset-password).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=reset_link_invalid`);
}
