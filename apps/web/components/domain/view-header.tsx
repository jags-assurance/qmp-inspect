import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Header for views that render both as a full page and embedded inside a workspace tab. Full page:
 * the standard PageHeader (back link, h1). Embedded: a compact h2 row, because the project header
 * and tab bar above already say which project this is.
 */
export function ViewHeader({
  embedded = false,
  backHref,
  backLabel = "Back to Project",
  title,
  guide,
  subtitle,
  badges,
  primaryAction,
  secondaryActions,
}: {
  embedded?: boolean;
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  guide?: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  if (!embedded) {
    return <PageHeader backHref={backHref} backLabel={backLabel} title={title} guide={guide} subtitle={subtitle} badges={badges} primaryAction={primaryAction} secondaryActions={secondaryActions} />;
  }
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-text-strong">{title}</h2>
        {guide}
        {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
      </div>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      {(primaryAction || secondaryActions) && <div className="mt-2 flex flex-wrap items-center gap-2">{primaryAction}{secondaryActions}</div>}
    </div>
  );
}
