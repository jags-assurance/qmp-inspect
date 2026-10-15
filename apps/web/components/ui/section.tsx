import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Card: the one surface container. White, 1px border, radius-lg, shadow-xs. `padded` adds the
 * standard 16px (20px from sm). Server-component safe.
 */
export function Card({
  children,
  className,
  padded = true,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: ElementType;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("rounded-lg border border-border bg-surface shadow-xs", padded && "p-4 sm:p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Section: a Card with a header row (title, description, actions). `collapsible` renders a native
 * <details>, so it works with no JavaScript and inside server components; `defaultOpen` sets the
 * initial state. `flush` removes body padding (tables / lists that go edge to edge).
 */
export function Section({
  title,
  description,
  actions,
  collapsible = false,
  defaultOpen = true,
  flush = false,
  id,
  headingLevel = 2,
  className,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right side of the header: a link, a Button, a count. Wraps below the title on phones. */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  flush?: boolean;
  id?: string;
  headingLevel?: 2 | 3;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const H = `h${headingLevel}` as ElementType;
  const heading = (
    <div className="min-w-0">
      <H className="text-base font-semibold leading-snug text-ink">{title}</H>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
    </div>
  );
  if (collapsible) {
    return (
      <details id={id} open={defaultOpen} className={cn("group rounded-lg border border-border bg-surface shadow-xs", className)}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90">
            <path d="M7 4.5l5.5 5.5-5.5 5.5" />
          </svg>
          {heading}
          {actions && <div className="ms-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </summary>
        <div className={cn("border-t border-border", !flush && "p-4 sm:p-5", bodyClassName)}>{children}</div>
      </details>
    );
  }
  return (
    <section id={id} className={cn("rounded-lg border border-border bg-surface shadow-xs", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
        {heading}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn(flush ? "mt-3" : "p-4 pt-3 sm:p-5 sm:pt-3", bodyClassName)}>{children}</div>
    </section>
  );
}
