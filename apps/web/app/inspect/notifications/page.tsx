import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { NOTIFICATIONS_TABLE, type NotificationRow } from "@/lib/notifications/types";
import { markAllNotificationsReadAction } from "@/lib/notifications/actions";
import { T } from "@/components/domain/t";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { FilterChips } from "@/components/ui/filter-chips";
import { EmptyState } from "@/components/ui/empty-state";
import { getTranslator } from "@/lib/i18n/server";

const PAGE_SIZE = 25;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const tl = await getTranslator();
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
    <div className="max-w-5xl space-y-5">
      <PageHeader
        className="mb-0"
        title={<T>Notifications</T>}
        subtitle={(unreadTotal ?? 0) > 0 ? <>{unreadTotal} <T>unread</T></> : undefined}
        primaryAction={
          (unreadTotal ?? 0) > 0 ? (
            <form action={markAll}>
              <Button type="submit" variant="outline">
                <T>Mark all read (</T>{unreadTotal})
              </Button>
            </form>
          ) : undefined
        }
      />

      <FilterChips
        label={tl("Filter notifications")}
        items={[
          { key: "all", label: tl("All"), href: "/inspect/notifications", active: !unreadOnly },
          { key: "unread", label: tl("Unread"), count: unreadTotal ?? 0, href: "/inspect/notifications?filter=unread", active: unreadOnly },
        ]}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface shadow-xs">
          <EmptyState
            title={unreadOnly ? "You're all caught up - no unread notifications." : "Nothing yet - this fills up as parties act on your projects."}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
          {rows.map((n) => {
            const inner = (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={"text-sm " + (n.is_read ? "text-ink" : "font-semibold text-ink")}>{n.title}</p>
                    {!n.is_read && <Badge tone="info" showIcon={false}><T>New</T></Badge>}
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">{n.body}</p>}
                  <p className="mt-1 text-xs text-muted">{new Date(n.created_at).toLocaleString("en-GB")}</p>
                </div>
              </div>
            );
            return (
              <li key={n.id} className={n.is_read ? "" : "bg-brand-soft"}>
                {n.link ? (
                  <Link href={`/inspect/notifications/open?id=${n.id}`} className="block min-h-11 hover:bg-surface-subtle">
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
        <div className="flex items-center justify-between gap-2 text-sm">
          {page > 1 ? (
            <Link href={qs(page - 1)} className="inline-flex min-h-11 items-center font-medium text-brand hover:underline">
              <T>Newer</T>
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            <T>Page</T> {page} <T>of</T> {pages}
          </span>
          {page < pages ? (
            <Link href={qs(page + 1)} className="inline-flex min-h-11 items-center font-medium text-brand hover:underline">
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
