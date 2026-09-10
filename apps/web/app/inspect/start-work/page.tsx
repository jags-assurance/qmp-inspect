import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";

export default async function StartWorkPage() {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect");

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Start work</h1>
      <p className="mt-1 text-sm text-muted">
        Choose the workflow that best matches the engagement. Both options take you to the real
        creation form — nothing is created until you submit it there.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <WorkModeCard
          badge="Full workflow"
          title="ITP-driven project"
          description="Plan and control a project through approved Inspection & Test Plans, linked checklists, intervention points and multi-party sign-off."
          bullets={[
            "Structured ITP workflow",
            "Client approval and intervention points",
            "Linked inspections, NCRs and data book",
          ]}
          bestFor="Best for projects and work packages"
          href="/inspect/itps/new"
          cta="Start ITP-driven project"
          emphasized
        />
        <WorkModeCard
          badge="Quick setup"
          title="Standalone assignment"
          description="Create a focused inspection without building a full project ITP. Ideal for FATs, vendor visits and one-off verification."
          bullets={[
            "Fast assignment setup",
            "Custom checklist and evidence",
            "Independent report and sign-off",
          ]}
          bestFor="Best for one-off or vendor inspections"
          href="/inspect/standalone/new"
          cta="Start standalone assignment"
        />
      </div>
    </div>
  );
}

function WorkModeCard({
  badge,
  title,
  description,
  bullets,
  bestFor,
  href,
  cta,
  emphasized = false,
}: {
  badge: string;
  title: string;
  description: string;
  bullets: string[];
  bestFor: string;
  href: string;
  cta: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-surface",
        emphasized ? "border-burgundy" : "border-border"
      )}
    >
      <div
        className={cn(
          "rounded-t-lg px-5 pb-4 pt-5",
          emphasized ? "bg-burgundy/5" : "bg-gold/10"
        )}
      >
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            emphasized ? "bg-burgundy text-white" : "bg-gold/30 text-[color:var(--color-burgundy-dark)]"
          )}
        >
          {badge}
        </span>
        <h2 className="mt-3 text-xl font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>

      <ul className="flex-1 space-y-2 px-5 py-4 text-sm text-ink">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className={cn("mt-0.5", emphasized ? "text-burgundy" : "text-gold")}>✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <p className="border-t border-border px-5 py-3 text-xs text-muted">
        <span className={emphasized ? "text-burgundy" : "text-[color:var(--color-burgundy-dark)]"}>★</span>{" "}
        {bestFor}
      </p>

      <div className="px-5 pb-5">
        <Link
          href={href}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            emphasized
              ? "bg-burgundy text-white hover:bg-burgundy-dark"
              : "border border-burgundy text-burgundy hover:bg-burgundy/5"
          )}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
