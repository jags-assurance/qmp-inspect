import { T } from "@/components/domain/t";
// Shared loading skeletons for route-level loading.tsx files. Server-component safe (no state), same
// look as the existing per-section skeletons (animate-pulse blocks on the off-white tone), so a new
// section's loading.tsx is two lines instead of a copy of the markup.

const block = "animate-pulse rounded bg-surface-sunken";

/** Primitive loading block: size it with className (h-4 w-32, h-24 w-full...). Decorative, aria-hidden. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`${block} ${className}`} />;
}

/** Page title, subtitle and one action button placeholder: matches <PageHeader>. */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      {action && <Skeleton className="h-10 w-32 rounded-md" />}
    </div>
  );
}

/** A StatGrid of placeholder tiles. */
export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 sm:gap-4">
      {Array.from({ length: tiles }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg border border-border" />
      ))}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" role="status" aria-label="Loading">
      {children}
      <span className="sr-only"><T>Loading</T></span>
    </div>
  );
}

function Heading({ withSubtitle = false }: { withSubtitle?: boolean }) {
  return (
    <>
      <div className={`h-7 w-64 max-w-full ${block}`} />
      {withSubtitle && <div className={`mt-2 h-4 w-96 max-w-full ${block}`} />}
    </>
  );
}

/** Heading, a filter bar and a table of rows (registers, punch list, audit log, project list). */
export function TableSkeleton({ rows = 8, filters = true }: { rows?: number; filters?: boolean }) {
  return (
    <Frame>
      <Heading withSubtitle />
      {filters && (
        <div className="mt-6 flex flex-wrap gap-3">
          <div className={`h-10 w-full max-w-xs rounded-md ${block}`} />
          <div className={`h-10 w-28 rounded-md ${block}`} />
          <div className={`h-10 w-28 rounded-md ${block}`} />
        </div>
      )}
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse border-b border-border bg-surface-sunken/60" />
        ))}
      </div>
    </Frame>
  );
}

/** Heading and a responsive grid of cards (start work, manage, reports, data book panels). */
export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <Frame>
      <Heading withSubtitle />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-surface-sunken" />
        ))}
      </div>
    </Frame>
  );
}

/** Heading, a row of stat tiles and two chart panels (KPIs, data book readiness). */
export function StatsSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <Frame>
      <Heading withSubtitle />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: tiles }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-surface-sunken" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-surface-sunken" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-surface-sunken" />
      </div>
    </Frame>
  );
}

/** Heading and a stack of form fields (new project). */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <Frame>
      <Heading />
      <div className="mt-6 max-w-2xl space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <div className={`h-4 w-32 ${block}`} />
            <div className={`mt-2 h-10 w-full rounded-md ${block}`} />
          </div>
        ))}
        <div className={`h-10 w-32 rounded-md ${block}`} />
      </div>
    </Frame>
  );
}

/** Heading and paragraphs of text (guides) or a feed of short entries (activity). */
export function TextSkeleton({ lines = 10 }: { lines?: number }) {
  return (
    <Frame>
      <Heading withSubtitle />
      <div className="mt-6 max-w-3xl space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={`h-4 ${block}`} style={{ width: `${95 - ((i * 13) % 35)}%` }} />
        ))}
      </div>
    </Frame>
  );
}

/** Heading, a header card with key facts, then a main panel and a side panel (record detail pages). */
export function DetailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Frame>
      <Heading withSubtitle />
      <div className="mt-6 h-20 animate-pulse rounded-lg border border-border bg-surface-sunken" />
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-surface-sunken" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-surface-sunken" />
      </div>
    </Frame>
  );
}


/** Filter-chip row placeholder: matches <FilterChips> (pills, scrolls sideways on phones). */
export function FilterChipsSkeleton({ chips = 5 }: { chips?: number }) {
  return (
    <div aria-hidden="true" className="scrollbar-none -mx-3 flex gap-2 overflow-hidden px-3 sm:mx-0 sm:px-0">
      {Array.from({ length: chips }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
      ))}
    </div>
  );
}

/**
 * A register / list route: PageHeader, FilterChips, FilterBar, then a table from md and designed cards
 * below it (the same switch DataTable makes). Use for route `loading.tsx` of list pages (ITPs, NCRs, ...).
 */
export function ListPageSkeleton({ rows = 8, chips = 5, action = true }: { rows?: number; chips?: number; action?: boolean }) {
  return (
    <Frame>
      <PageHeaderSkeleton action={action} />
      <div className="space-y-4">
        <FilterChipsSkeleton chips={chips} />
        <div aria-hidden="true" className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Skeleton className="h-10 w-full rounded-md sm:max-w-xs [@media(pointer:coarse)]:h-11" />
          <Skeleton className="hidden h-10 w-32 rounded-md md:block" />
          <Skeleton className="hidden h-10 w-32 rounded-md md:block" />
          <Skeleton className="h-10 w-24 rounded-md md:hidden [@media(pointer:coarse)]:h-11" />
        </div>
        <div aria-hidden="true" className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
          <div className="h-11 border-b border-border bg-surface-subtle" />
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse border-b border-border bg-surface-sunken/60 last:border-b-0" />
          ))}
        </div>
        <div aria-hidden="true" className="space-y-3 md:hidden">
          {Array.from({ length: Math.min(rows, 5) }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg border border-border" />
          ))}
        </div>
      </div>
    </Frame>
  );
}
