import Link from "next/link";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonVariants } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { T } from "@/components/domain/t";
import { cn } from "@/lib/cn";
import type { NextStepItem } from "@/lib/dashboard/next-steps";
import type { StageState } from "@/lib/itps/flow";

/** What the process means for each kind of login, in a few plain sentences (shown folded, on every dashboard). */
const HOW_IT_WORKS: Record<string, string[]> = {
  client: [
    "JAGS approves the plan, then you accept it. Work can start after that.",
    "During the work you may be invited to watch a test, or asked to approve a Hold. A Hold stops the next work until it is signed.",
    "When it is your turn the activity shows up here with a green button. Open it, check, and press Sign off.",
  ],
  main_contractor: [
    "Each activity has steps in order. Some steps (a Hold) must be signed before the next one can start.",
    "When it is your turn it shows up here with a green button. Open it, check the work, and press Sign off.",
    "If it is not your turn yet, the activity tells you what it is waiting for.",
  ],
  subcontractor: [
    "Each activity has steps in order. Some steps (a Hold) must be signed before the next one can start.",
    "When it is your turn it shows up here with a green button. Open it, check the work, and press Sign off.",
    "If it is not your turn yet, the activity tells you what it is waiting for.",
  ],
  tpi_lab: [
    "You test or certify at the steps given to you. Attach your certificates from the Document Vault on the activity.",
    "When it is your turn it shows up here with a green button. Open it, check, and press Sign off.",
    "A Hold means work waits for your sign-off, so please act on those first.",
  ],
  staff: [
    "You run the process: press Notify so the right party is asked, and watch the steps turn green.",
    "A step you can sign for JAGS shows up here with a green button. Open it and press Sign off.",
    "A Hold stops the next work until it is signed, so clear Holds first.",
  ],
};

function Dot({ state, you }: { state: StageState; you: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
        state === "done" && "border-success bg-success text-white",
        state === "current" && "border-success bg-success/15 text-success",
        state !== "done" && state !== "current" && "border-control-border bg-surface text-muted",
        you && state !== "done" && "ring-2 ring-success/40"
      )}
    >
      {state === "done" ? "✓" : state === "waiting" ? "…" : ""}
    </span>
  );
}

/**
 * "Your next steps": the activities where it is your turn, each with a small strip showing where it is in the order
 * of sign-offs (green tick = done, green ring = happening now, grey = later) and one green button to open it. Kept
 * short on purpose (a handful of items), with the explanation folded away for people who want it.
 */
export function NextStepsCard({ items, total, roleKey, isStaff }: { items: NextStepItem[]; total: number; roleKey: string | null; isStaff: boolean }) {
  const how = HOW_IT_WORKS[isStaff ? "staff" : (roleKey ?? "")] ?? HOW_IT_WORKS.subcontractor;
  const more = total - items.length;
  return (
    <section aria-label="Your next steps" className="mb-6 mt-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink"><T>Your next steps</T></h2>
        {items.length > 0 && <p className="text-xs text-muted"><T>Do these first.</T></p>}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink">
          <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-xs font-bold text-white">✓</span>
          <T>You are all caught up. Nothing needs you right now.</T>
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{item.activity}</p>
                <p className="text-xs text-muted">
                  <span className="doc-id">{item.itpNumber}</span>
                  {item.projectName ? ` · ${item.projectName}` : ""}
                </p>
                {item.stages.length > 0 && (
                  <ol className="mt-2 flex items-center" aria-label="Where this activity is in the process">
                    {item.stages.map((stage, i) => (
                      <li key={stage.code} className="flex items-center" title={stage.label}>
                        <Dot state={stage.state} you={stage.hasYou} />
                        <span className="sr-only">{stage.label}</span>
                        {i < item.stages.length - 1 && <span aria-hidden="true" className={cn("h-0.5 w-5", stage.state === "done" ? "bg-success" : "bg-border")} />}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-1.5 text-xs text-ink">
                  {item.kind === "notify" ? (
                    <T>Nobody has been asked to sign this yet.</T>
                  ) : item.position ? (
                    <>
                      <span className="font-medium"><T>Step</T> {item.position.index} <T>of</T> {item.position.total}.</span> <Tx>{item.position.text}</Tx>
                    </>
                  ) : null}
                </p>
              </div>
              <Link
                href={item.href}
                prefetch={false}
                className={cn(buttonVariants({ variant: "primary" }), "w-full shrink-0 border-success bg-success hover:bg-success/90 sm:w-auto")}
              >
                <Tx>{item.kind === "notify" ? "Open and ask them" : "Open and sign off"}</Tx> →
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-3 text-xs text-muted">
          + {more} <T>more.</T>{" "}
          <Link href="/inspect/itps" className="text-brand hover:underline"><T>See all ITPs</T></Link>
        </p>
      )}
      <Disclosure variant="inline" summary={<T>How does this work?</T>} className="mt-3">
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-muted">
          {how.map((line) => (
            <li key={line}><Tx>{line}</Tx></li>
          ))}
        </ol>
      </Disclosure>
    </section>
  );
}
