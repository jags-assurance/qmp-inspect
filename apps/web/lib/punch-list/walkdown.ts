// S5-23: walkdown sign-off rules and summary. Pure, unit-tested.
// The walkdowns table's update policy lets the creator or an admin change a row, so those are
// exactly the people who may sign off.

export function walkdownSignOffError(input: {
  isCreator: boolean;
  isAdmin: boolean;
  alreadySigned: boolean;
  itemCount: number;
}): string | null {
  if (input.alreadySigned) return "This walkdown was already signed off.";
  if (!input.isCreator && !input.isAdmin) return "Only the person who recorded the walkdown, or a JAGS admin, can sign it off.";
  if (input.itemCount <= 0) return "A walkdown with no items cannot be signed off.";
  return null;
}

export interface WalkdownItemLite {
  status: string;
  priority: string | null;
  withdrawn_at?: string | null;
}

export interface WalkdownSummary {
  total: number;
  open: number;
  resolved: number;
  closed: number;
  byPriority: Record<string, number>;
}

export function summariseWalkdown(items: WalkdownItemLite[]): WalkdownSummary {
  const live = items.filter((i) => !i.withdrawn_at);
  const byPriority: Record<string, number> = {};
  for (const i of live) {
    const p = i.priority ?? "B";
    byPriority[p] = (byPriority[p] ?? 0) + 1;
  }
  return {
    total: live.length,
    open: live.filter((i) => i.status === "open").length,
    resolved: live.filter((i) => i.status === "resolved").length,
    closed: live.filter((i) => i.status === "closed").length,
    byPriority,
  };
}
