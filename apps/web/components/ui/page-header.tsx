import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { PageActionsMenu } from "@/components/ui/page-actions-menu";
import { Tx } from "@/components/domain/tx";

/**
 * The top of every page: back link, title (+ guide button, status badges), subtitle, and the page's
 * actions. Server-component safe (only the phone overflow menu is a client island).
 *
 * Actions: `primaryAction` is THE action of the page (one). `secondaryActions` are the rest (exports,
 * print, link-style tools). From sm they sit inline to the right (primary first, then secondary);
 * on phones the primary stays visible full-width under the title and the secondary actions fold into
 * a "..." menu so the header never stacks five buttons.
 */
export function PageHeader({
  title,
  subtitle,
  badges,
  guide,
  backHref,
  backLabel = "Back",
  primaryAction,
  secondaryActions,
  meta,
  className,
  titleAs = "h1",
}: {
  title: ReactNode;
  /** One calm line under the title (scope, date, count). */
  subtitle?: ReactNode;
  /** Status badges shown next to the title (<Badge> elements). */
  badges?: ReactNode;
  /** A <PageGuide> (or any small control) rendered right after the title. */
  guide?: ReactNode;
  backHref?: string;
  backLabel?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  /** Extra row below the subtitle (links, key facts). */
  meta?: ReactNode;
  className?: string;
  /** Heading level for the title; embedded views use "h2" because the host page already has the h1. */
  titleAs?: "h1" | "h2";
}) {
  const hasActions = Boolean(primaryAction || secondaryActions);
  const Title = titleAs;
  return (
    <header className={cn("mb-5 sm:mb-6", className)}>
      {backHref && (
        <Link href={backHref} className="-ms-1 mb-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-sm text-muted hover:text-ink [@media(pointer:coarse)]:min-h-11">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 rtl:-scale-x-100">
            <path d="M12.5 4.5L7 10l5.5 5.5" />
          </svg>
          <Tx>{backLabel}</Tx>
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Title className="text-2xl font-semibold leading-tight tracking-tight text-text-strong sm:text-[1.75rem]">{title}</Title>
            {guide}
            {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
          </div>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          {meta && <div className="mt-1 text-sm text-muted">{meta}</div>}
        </div>
        {hasActions && (
          <div className="no-print flex w-full items-center gap-2 sm:w-auto sm:flex-wrap sm:justify-end">
            {primaryAction && <div className="min-w-0 flex-1 sm:flex-none [&>*]:w-full sm:[&>*]:w-auto [&_button]:w-full sm:[&_button]:w-auto [&_a]:w-full sm:[&_a]:w-auto">{primaryAction}</div>}
            {secondaryActions && (
              <>
                <div className="hidden items-center gap-2 sm:flex sm:flex-wrap">{secondaryActions}</div>
                <div className="sm:hidden">
                  <PageActionsMenu>{secondaryActions}</PageActionsMenu>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
