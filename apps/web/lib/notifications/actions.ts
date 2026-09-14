"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NOTIFICATIONS_TABLE } from "./types";

export async function markNotificationReadAction(notificationId: string): Promise<void> {
  if (!notificationId) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from(NOTIFICATIONS_TABLE).update({ is_read: true }).eq("id", notificationId);
  revalidatePath("/inspect", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from(NOTIFICATIONS_TABLE).update({ is_read: true }).eq("recipient_user_id", user.id).eq("is_read", false);
  revalidatePath("/inspect", "layout");
}
