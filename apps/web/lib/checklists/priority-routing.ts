// Dynamic priority routing for the Inspector dashboard's "My pending actions" worklist
// (app/inspect/page.tsx). Pulled out as pure logic so it's unit-testable without a live Supabase
// request context — same reasoning as completion-logic.ts.
//
// Real gap this closes: pendingActions used to be whichever 8 checklist templates were created most
// recently (`.order("created_at", { ascending: false }).slice(0, 8)`), regardless of urgency. A
// high-priority Hold-gated activity sitting unanswered for a week could be pushed off the inspector's
// list entirely by 8 newer low-priority ones. Sorting by real priority (already computed from each
// activity's own intervention levels — see page.tsx's priorityByItem, not invented here) before
// truncating means the items actually surfaced are the most urgent ones, not just the newest.

export type DynamicPriority = "high" | "medium" | "low";

const PRIORITY_RANK: Record<DynamicPriority, number> = { high: 0, medium: 1, low: 2 };

export interface PriorityRoutable {
  priority: DynamicPriority;
  /** Days since the item became pending — used as the tiebreaker within the same priority tier, so
   *  the item that's been waiting longest at a given urgency level surfaces first. */
  ageDays: number;
}

/**
 * Sorts by priority tier first (high before medium before low), then by age within a tier (the
 * longest-waiting item first) — never mutates the input array.
 */
export function sortByDynamicPriority<T extends PriorityRoutable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rankDiff !== 0) return rankDiff;
    return b.ageDays - a.ageDays;
  });
}
