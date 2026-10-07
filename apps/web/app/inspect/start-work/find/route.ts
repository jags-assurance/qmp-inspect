import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { CHECKLIST_TEMPLATES_TABLE } from "@/lib/checklists/db-types";

/**
 * QR / tag deep link (S4-20): a sticker on equipment or a drawing encodes
 *   /inspect/start-work/find?code=<checklist number>
 * and a phone's camera app opens the matching checklist directly. An unknown code falls back to the
 * Start work search so the inspector still lands somewhere useful. RLS decides what is visible.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionContext();
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().slice(0, 80);
  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `/inspect/start-work/find?code=${encodeURIComponent(code)}`);
    return NextResponse.redirect(login);
  }
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("id")
      .eq("checklist_number", code)
      .limit(2)
      .returns<{ id: string }[]>();
    if (data && data.length === 1) return NextResponse.redirect(new URL(`/inspect/checklists/${data[0].id}`, req.url));
  }
  return NextResponse.redirect(new URL(`/inspect/start-work${code ? `?q=${encodeURIComponent(code)}` : ""}`, req.url));
}
