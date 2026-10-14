"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { ACTIVE_ORG_COOKIE, grantedOrgIds } from "./active-org";

/** Switches the organisation the nav/branding/licensing follow. Validated against the caller's own grants. */
export async function setActiveOrganisationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const orgId = String(formData.get("organization_id") ?? "");
  if (!grantedOrgIds(session.grants).includes(orgId)) return; // not one of your organisations: ignore
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
