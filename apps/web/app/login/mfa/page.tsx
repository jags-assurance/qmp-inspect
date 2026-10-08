import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MfaForm } from "./mfa-form";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { mfaEnabled } from "@/lib/auth/mfa";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!mfaEnabled()) notFound();
  const { next } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <MfaForm next={safeNextPath(typeof next === "string" ? next : undefined)} />;
}
