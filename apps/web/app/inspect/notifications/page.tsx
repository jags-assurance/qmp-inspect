import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { NOTIFICATIONS_TABLE, type NotificationRow } from "@/lib/notifications/types";
import { markAllNotificationsReadAction } from "@/lib/notifications/actions";
import { T } from "@/components/domain/t";

const PAGE_SIZE = 25;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const session = await requireSession();
  const { filter, page: pageParam } = await searchParams;
  const unreadOnly = filter === "unread";
  const page = Math.max(1, Number(pageParam ?? "1") || 1);
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from(NOTIFICATIONS_TABLE)
    .select("*", { count: "exact" })
    .eq("recipient_user_id", session.userId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (unreadOnly) query = query.eq("is_read", false);
  const { data, count } = await query.returns<NotificationRow[]>();
  const rows = data ?? [];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { count: unreadTotal } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", session.userId)
    .eq("is_read", false);

  const qs = (p: number) => `?${unreadOnly ? "filter=unread&" : ""}page=${p}`;

  async function markAll() {
    "use server";
    await markAllNotificationsReadAction();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink"><T>Notifications</T></h1>
        {(unreadTotal ?? 0) > 0 && (
          <form action={markAll}>
            <button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm text-burgundy hover:bg-off-white">
              <T>Mark all read (</T>{unreadTotal})
            </button>
          </form>
        )}
      </div>

      <div className="mt-4 flex gap-2 text-sm">
        <Link
          href="/inspect/notifications"
          className={"min-h-11 rounded-md border px-3 py-2.5 " + (!unreadOnly ? "border-burgundy bg-burgundy/5 text-burgundy" : "border-border text-muted")}
        >
          <T>All</T>
        </Link>
        <Link
          href="/inspect/notifications?filter=unread"
          className={"min-h-11 rounded-md border px-3 py-2.5 " + (unreadOnly ? "border-burgundy bg-burgundy/5 text-burgundy" : "border-border text-muted")}
        >
          <T>Unread</T>
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
          {unreadOnly ? "You're all caught up - no unread notifications." : "Nothing yet - this fills up as parties act on your projects."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((n) => {
            const inner = (
              <div className="flex items-start gap-2 px-4 py-3">
                {!n.is_read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-burgundy" />}
                <div className="min-w-0 flex-1">
                  <p className={"text-sm " + (n.is_read ? "text-ink" : "font-semibold text-ink")}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted">{new Date(n.created_at).toLocaleString("en-GB")}</p>
                </div>
              </div>
            );
            return (
              <li key={n.id} className={n.is_read ? "" : "bg-burgundy/5"}>
                {n.link ? (
                  <Link href={`/inspect/notifications/open?id=${n.id}`} className="block hover:bg-off-white">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={qs(page - 1)} className="min-h-11 py-2.5 text-burgundy hover:underline">
              <T>Newer</T>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            <T>Page</T> {page} <T>of</T> {pages}
          </span>
          {page < pages ? (
            <Link href={qs(page + 1)} className="min-h-11 py-2.5 text-burgundy hover:underline">
              <T>Older</T>
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
