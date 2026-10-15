import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EXPIRING_KIND_LABEL, getExpiringRegisterItems } from "@/lib/registers/expiring";
import { describeDays } from "@/lib/registers/status";
import { T } from "@/components/domain/t";

/**
 * S3-12: dashboard widget listing calibrations, welder qualifications and personnel certificates that have
 * lapsed or lapse within 30 days, across every project the viewer can see (RLS decides). Renders nothing
 * when everything is in date, so it never adds noise.
 */
export async function ExpiringClearancesCard({ withinDays = 30 }: { withinDays?: number }) {
  const supabase = await createSupabaseServerClient();
  const { items, total } = await getExpiringRegisterItems(supabase, withinDays, 6);
  if (total === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4" data-testid="expiring-clearances">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-ink"><T>Expiring clearances</T></h2>
        <span className="text-xs text-muted">
          {total} <T>lapsed or lapsing within</T> {withinDays} <T>days</T>
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border text-sm">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={`/inspect/projects/${item.projectId}/registers`}
              className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-subtle"
            >
              <span className="text-ink">
                {item.label} <span className="text-xs text-muted">· {EXPIRING_KIND_LABEL[item.kind]}</span>
              </span>
              <span className={item.days < 0 ? "text-xs font-medium text-danger" : "text-xs text-muted"}>
                {item.date} · {describeDays(item.days)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > items.length && <p className="mt-2 text-xs text-muted"><T>and</T> {total - items.length} <T>more</T></p>}
    </div>
  );
}
