"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, normalizeLocale } from "./direction";

/**
 * Stores the chosen UI locale in a cookie; the root layout reads it and sets <html lang dir>.
 * Not security sensitive (display preference only), so no session is required and the value is
 * always normalised to a supported locale before it is stored.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = normalizeLocale(String(formData.get("locale") ?? ""));
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
