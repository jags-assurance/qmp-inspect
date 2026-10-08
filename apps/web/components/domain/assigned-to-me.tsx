import Link from "next/link";
import type { AssignedActivity } from "@/lib/checklists/assigned-queries";
import { T } from "@/components/domain/t";

/** "Assigned to me" queue section (Start work page and inspector dashboard). Renders nothing when empty unless told to. */
export function AssignedToMe({ items, showEmpty = false }: { items: AssignedActivity[]; showEmpty?: boolean }) {
  if (items.length === 0 && !showEmpty) return null;
  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4" id="assigned-to-me">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-ink"><T>Assigned to me (</T>{items.length})</h2>
        <Link href="/inspect/start-work?assigned=me" className="text-sm text-burgundy hover:underline">
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
                className="flex min-h-11 flex-col gap-0.5 py-2 hover:bg-off-white sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0 truncate text-sm text-ink">
                  {a.itemNumber}. {a.activity}
                </span>
                <span className="text-xs text-muted">
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
