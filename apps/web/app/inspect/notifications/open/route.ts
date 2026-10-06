import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NOTIFICATIONS_TABLE } from "@/lib/notifications/types";

// Marks one of the signed-in user's own notifications read, then redirects to its link.
// Only same-origin relative links are followed.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let target = "/inspect/notifications";
  if (user && id) {
    const { data } = await supabase
      .from(NOTIFICATIONS_TABLE)
      .select("link")
      .eq("id", id)
      .eq("recipient_user_id", user.id)
      .maybeSingle<{ link: string | null }>();
    if (data) {
      await supabase.from(NOTIFICATIONS_TABLE).update({ is_read: true }).eq("id", id).eq("recipient_user_id", user.id);
      if (data.link && data.link.startsWith("/") && !data.link.startsWith("//")) target = data.link;
    }
  }
  return NextResponse.redirect(new URL(target, request.url));
}
