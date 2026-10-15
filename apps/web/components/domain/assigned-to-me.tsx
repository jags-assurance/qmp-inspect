import Link from "next/link";
import type { AssignedActivity } from "@/lib/checklists/assigned-queries";
import { T } from "@/components/domain/t";

/** "Assigned to me" queue section (Start work page and inspector dashboard). Renders nothing when empty unless told to. */
export function AssignedToMe({ items, showEmpty = false, className = "mt-6" }: { items: AssignedActivity[]; showEmpty?: boolean; className?: string }) {
  if (items.length === 0 && !showEmpty) return null;
  return (
    <div className={`scroll-mt-24 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 ${className}`} id="assigned-to-me">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink"><T>Assigned to me (</T>{items.length})</h2>
        <Link href="/inspect/start-work?assigned=me" className="inline-flex min-h-9 items-center text-sm font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
          <T>Open in Start work</T>
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted"><T>Nothing is assigned to you right now.</T></p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.slice(0, 8).map((a) => (
            <li key={a.templateId}>
              <Link
                href={`/inspect/checklists/${a.templateId}`}
                className="flex min-h-11 flex-col gap-0.5 rounded-md py-2 hover:bg-surface-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="min-w-0 truncate text-sm font-medium text-ink" title={`${a.itemNumber}. ${a.activity}`}>
                  {a.itemNumber}. {a.activity}
                </span>
                <span className="text-xs text-muted [overflow-wrap:anywhere]">
                  {a.projectName} - {a.itpNumber}
                  {a.plannedDate ? ` - due ${a.plannedDate}` : ""} - {a.status === "in_progress" ? "In progress" : "Not started"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
