import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { loginNotice } from "@/lib/auth/login-notices";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Only same-site paths are honoured, so the link cannot bounce someone to another website.
  const safeNext = safeNextPath(typeof next === "string" ? next : undefined);
  return <LoginForm next={safeNext} notice={loginNotice(error)} />;
}
