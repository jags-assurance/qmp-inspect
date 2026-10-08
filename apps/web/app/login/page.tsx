import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { loginNotice } from "@/lib/auth/login-notices";
import { getLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/locale-context";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Only same-site paths are honoured, so the link cannot bounce someone to another website.
  const safeNext = safeNextPath(typeof next === "string" ? next : undefined);
  // The sign-in page sits outside the inspect layout, so it supplies the locale itself.
  return (
    <LocaleProvider locale={await getLocale()}>
      <LoginForm next={safeNext} notice={loginNotice(error)} />
    </LocaleProvider>
  );
}
