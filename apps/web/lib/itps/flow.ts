import { resolveUnclearedLowerLevel } from "@/lib/signoff/sequencing";
import type { SignoffStatus } from "@/lib/signoff/db-types";

/**
 * The order in which the people on one activity act, in plain terms. It adds no new rule: it orders the parties by
 * their intervention level (the organisation's own level order) and uses the existing sequencing rule
 * (resolveUnclearedLowerLevel) to say which steps must wait for an earlier one: in the default "flexible" mode only a
 * Hold-type (blocking) level makes later levels wait; in "strict" mode every earlier level does.
 */

export interface FlowLevel {
  code: string;
  label: string;
  sort_order: number;
  is_blocking: boolean;
}

export interface FlowCell {
  partyId: string;
  partyName: string;
  /** Level code on this activity; null = the party has no part in it (never a step). */
  intervention: string | null;
  status: SignoffStatus | null;
  /** The viewer is this party (or may act for it): marks "your" step. */
  isYou: boolean;
}

export type StepState =
  /** Signed off. */
  | "done"
  /** Proceeded without a response (counts as cleared for ordering, but is not a sign-off). */
  | "proceeded"
  /** Notified and nothing earlier is in the way: this is the one to act now. */
  | "now"
  /** Must wait for an earlier step (named in `waitingFor`). */
  | "waiting"
  /** Nobody has asked this party yet (still needs Notify). */
  | "not_asked";

export interface FlowStep {
  partyId: string;
  partyName: string;
  state: StepState;
  waitingFor: string | null;
  isYou: boolean;
}

export type StageState = "done" | "current" | "waiting" | "upcoming";

export interface FlowStage {
  code: string;
  label: string;
  blocking: boolean;
  /** One plain sentence: what this kind of step means for the people in it. */
  plainRole: string;
  state: StageState;
  steps: FlowStep[];
}

/** What a level means, in words a site team uses. */
export function plainRole(level: Pick<FlowLevel, "code" | "label" | "is_blocking">): string {
  if (level.is_blocking) return "Must approve before work can go on";
  switch (level.code) {
    case "W":
      return "Invited to be present; work can go on if they do not reply in time";
    case "R":
      return "Checks the records afterwards";
    case "S":
      return "Spot-checks; does not stop work";
    default:
      return level.label;
  }
}

export function buildActivityFlow(cells: FlowCell[], levels: FlowLevel[], strictMode: boolean): FlowStage[] {
  const order = [...levels].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  const active = cells.filter((c): c is FlowCell & { intervention: string } => !!c.intervention);
  const prior = active.map((c) => ({ intervention: c.intervention, status: (c.status ?? "pending") as SignoffStatus }));
  const codes = [...new Set(active.map((c) => c.intervention))];
  codes.sort((a, b) => {
    const ia = order.findIndex((l) => l.code === a);
    const ib = order.findIndex((l) => l.code === b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });

  return codes.map((code) => {
    const level = order.find((l) => l.code === code) ?? { code, label: code, sort_order: 999, is_blocking: false };
    const waitingFor = resolveUnclearedLowerLevel(order, code, strictMode, prior);
    const steps: FlowStep[] = active
      .filter((c) => c.intervention === code)
      .map((c) => {
        let state: StepState;
        if (c.status === "signed_off") state = "done";
        else if (c.status === "proceeded_no_response") state = "proceeded";
        else if (waitingFor) state = "waiting";
        else if (c.status === "notified") state = "now";
        else state = "not_asked";
        return { partyId: c.partyId, partyName: c.partyName, state, waitingFor: state === "waiting" ? waitingFor : null, isYou: c.isYou };
      });
    const cleared = steps.every((s) => s.state === "done" || s.state === "proceeded");
    const state: StageState = cleared ? "done" : steps.some((s) => s.state === "now") ? "current" : steps.every((s) => s.state === "waiting" || s.state === "done" || s.state === "proceeded") ? "waiting" : "upcoming";
    return { code, label: level.label, blocking: level.is_blocking, plainRole: plainRole(level), state, steps };
  });
}

/** "Step 2 of 3" for the viewer, plus what holds them up, or null when the viewer has no step. */
export function flowPosition(stages: FlowStage[]): { index: number; total: number; text: string } | null {
  const idx = stages.findIndex((s) => s.steps.some((st) => st.isYou));
  if (idx === -1) return null;
  const mine = stages[idx].steps.find((st) => st.isYou)!;
  const total = stages.length;
  let text: string;
  if (mine.state === "done") text = "You have signed off.";
  else if (mine.state === "proceeded") text = "This went ahead without your reply.";
  else if (mine.state === "now") text = "It is your turn.";
  else if (mine.state === "waiting") text = `Waiting for ${mine.waitingFor ?? "an earlier step"} to be signed off first.`;
  else text = "You have not been asked yet.";
  return { index: idx + 1, total, text };
}
