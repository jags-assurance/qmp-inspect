import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
} from "@/lib/registers/types";
import { rateLimitResponse } from "@/lib/api/rate-limit";

const TABLES = {
  calibration: CALIBRATION_REGISTER_TABLE,
  welder: WELDER_QUALIFICATION_REGISTER_TABLE,
  material: MATERIAL_REGISTER_TABLE,
  personnel: PERSONNEL_CERTIFICATIONS_TABLE,
} as const;

/**
 * Opens a register entry's certificate file: looks the entry up through the caller's own session (so
 * only someone who can see that project's register can get its file), then redirects to a short-lived
 * signed URL.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as keyof typeof TABLES | null;
  const id = url.searchParams.get("id");
  if (!kind || !(kind in TABLES) || !id) return NextResponse.json({ error: "Missing entry." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to open this file." }, { status: 401 });
  const limited = rateLimitResponse("export", user.id);
  if (limited) return limited;

  const { data: entry } = await supabase
    .from(TABLES[kind])
    .select("certificate_path")
    .eq("id", id)
    .maybeSingle<{ certificate_path: string | null }>();
  if (!entry?.certificate_path) return NextResponse.json({ error: "No certificate is attached to this entry." }, { status: 404 });

  const { data: signed, error } = await supabase.storage.from("inspection-evidence").createSignedUrl(entry.certificate_path, 300);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "Could not open the file." }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl);
}
