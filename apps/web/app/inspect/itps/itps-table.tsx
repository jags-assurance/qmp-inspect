"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ITP_STATUS_LABEL, ITP_STATUS_TONE } from "./itp-status";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import type { SupportedLocale } from "@/lib/i18n/direction";
import { useServerDrivenTableParams } from "@/lib/hooks/use-server-driven-table-params";
import { ITP_TABLE_PAGE_SIZE as PAGE_SIZE } from "./constants";
import { ITP_PHASE_LABEL, ITP_PHASE_TONE, normalizeItpPhase } from "@/lib/itps/phase";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useSetFilterParam } from "@/lib/hooks/use-filter-param";
import type { ActivityProgress } from "@/lib/itps/progress";

export interface ItpRow {
  id: string;
  itp_number: string;
  title: string;
  status: string;
  revision: number;
  phase: string;
  projects: { name: string } | null;
  /** Activity sign-off summary (see lib/itps/progress.ts); absent when the ITP has no sign-off rows. */
  progress?: ActivityProgress;
}

/** "X of Y activities fully signed off" + thin progress bar + outstanding sign-off count. */
function ProgressCell({ progress }: { progress?: ActivityProgress }) {
  const tl = useTranslate();
  if (!progress || progress.total === 0) {
    return <span className="text-xs text-muted"><Tx>No sign-off points</Tx></span>;
  }
  return (
    <span className="block min-w-0 space-y-1">
      <span className="block text-xs text-ink">
        <span className="font-medium tabular-nums">{progress.complete} <Tx>of</Tx> {progress.total}</span> <Tx>activities fully signed off</Tx>
      </span>
      <span
        role="progressbar"
        aria-label={tl("Activities fully signed off")}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.complete}
        aria-valuetext={`${progress.complete} ${tl("of")} ${progress.total} ${tl("activities fully signed off")}`}
        className="block h-1.5 w-full overflow-hidden rounded-full bg-border"
      >
        <span className="block h-full rounded-full bg-success" style={{ width: `${progress.percent}%` }} />
      </span>
      <span className="block text-xs text-muted tabular-nums">
        {progress.outstanding === 0 ? <Tx>All sign-offs complete</Tx> : <>{progress.outstanding} <Tx>sign-offs outstanding</Tx></>}
      </span>
    </span>
  );
}

// Exported so other pages rendering the same ITP status enum (e.g.
// app/inspect/itps/[id]/checklists/page.tsx) can reuse this instead of duplicating a copy.

function buildColumns(hrefFor: (id: string) => string, selectedId: string | null): DataTableColumn<ItpRow>[] {
  const cur = (id: string) => (id === selectedId ? "page" : undefined);
  // With an ITP open beside the list the table only has ~400px, and six columns wrapped word by word
  // into towers of text. In that split view each ITP is one compact, whole-row-tappable cell instead:
  // number + status on top, title (max two lines), project underneath.
  if (selectedId) {
    return [
      {
        key: "itp",
        header: "ITPs",
        render: (row) => (
          <Link
            prefetch={false}
            href={hrefFor(row.id)}
            scroll={false}
            aria-current={cur(row.id)}
            className={`-mx-2 -my-1.5 block min-w-0 rounded-md border-s-2 px-2 py-2 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-burgundy ${row.id === selectedId ? "border-burgundy bg-off-white" : "border-transparent"}`}
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className={`doc-id text-sm text-burgundy [overflow-wrap:anywhere] ${row.id === selectedId ? "font-semibold" : ""}`}>{row.itp_number}</span>
              <span className="text-xs text-muted"><Tx>Rev</Tx> {row.revision}</span>
            </span>
            <span className="mt-1 block whitespace-nowrap">
              <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"} showIcon>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>
            </span>
            <span className="mt-1 line-clamp-2 block break-words text-sm text-ink" title={row.title}>{row.title}</span>
            <span className="mt-1.5 block"><ProgressCell progress={row.progress} /></span>
            {row.projects?.name && <span className="mt-0.5 line-clamp-2 block break-words text-xs text-muted" title={row.projects.name}>{row.projects.name}</span>}
          </Link>
        ),
      },
    ];
  }
  return [
  {
    key: "itp_number",
    header: "ITP No.",
    sortable: true,
    render: (row) => (
      <Link prefetch={false} href={hrefFor(row.id)} scroll={false} aria-current={cur(row.id)} className={`doc-id inline-flex min-h-11 items-center text-burgundy hover:underline ${row.id === selectedId ? "font-semibold" : ""}`}>
        {row.itp_number}
      </Link>
    ),
  },
  {
    key: "title",
    header: "Title",
    sortable: true,
    // Round-table field-usability finding: only the (small, monospace) ITP number was clickable —
    // the title, the more visually prominent and legible column, was plain text.
    render: (row) => (
      <Link prefetch={false} href={hrefFor(row.id)} scroll={false} aria-current={cur(row.id)} className={`inline-flex min-h-11 items-center text-ink hover:underline ${row.id === selectedId ? "font-semibold" : ""}`}>
        {row.title}
      </Link>
    ),
  },
  { key: "project", header: "Project", render: (row) => row.projects?.name ?? "—" },
  { key: "revision", header: "Rev", render: (row) => row.revision },
  {
    key: "status",
    header: "Status",
    sortable: true,
    render: (row) => <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"} showIcon>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>,
  },
  { key: "progress", header: "Sign-off progress", sortable: true, render: (row) => <div className="w-44 max-w-full"><ProgressCell progress={row.progress} /></div> },
  {
    key: "phase",
    header: "Phase",
    // R23: real lifecycle phase (Development/Execution/Handover), distinct from the approval-
    // workflow status column above — see lib/itps/phase.ts.
    render: (row) => {
      const phase = normalizeItpPhase(row.phase);
      return <Badge tone={ITP_PHASE_TONE[phase]}>{ITP_PHASE_LABEL[phase]}</Badge>;
    },
  },
  ];
}

/**
 * Round-table performance finding (same as apps/web/app/inspect/ncrs/ncrs-table.tsx): this
 * register used to receive and client-filter EVERY matching ITP row at once. `totalCount` (when
 * provided by the server page) switches this into server-driven search + pagination: `rows` is
 * just the current page, search text and page number both live in the URL (`q`, `page`). Falls
 * back to the original all-client-side behavior when `totalCount` is omitted.
 */
export function ItpsTable({ rows, totalCount, locale }: { rows: ItpRow[]; totalCount?: number; locale?: SupportedLocale }) {
  const setParam = useSetFilterParam();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("itp");
  const hrefFor = useCallback(
    (id: string) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set("itp", id);
      p.delete("pane");
      return `?${p.toString()}`;
    },
    [searchParams]
  );
  const columns = useMemo(() => buildColumns(hrefFor, selectedId), [hrefFor, selectedId]);
  const serverDriven = totalCount !== undefined;
  const sortParam = searchParams.get("sort") ?? "";
  // Column key -> ?sort= value. Direction is fixed per sort (completion is highest first, the rest ascending).
  const SORT_BY_COLUMN: Record<string, string> = { itp_number: "number", title: "title", status: "status", progress: "completion" };
  const activeColumn = Object.entries(SORT_BY_COLUMN).find(([, v]) => v === sortParam)?.[0] ?? "";
  const { searchValue, setSearchValue, page, goToPage } = useServerDrivenTableParams(serverDriven);

  return (
    <DataTable
      columns={columns}
      locale={locale}
      rows={rows}
      caption="Inspection and test plans"
      sort={{
        key: activeColumn,
        direction: sortParam === "completion" ? "desc" : "asc",
        onSort: (key) => setParam("sort", SORT_BY_COLUMN[key] === sortParam ? "" : (SORT_BY_COLUMN[key] ?? "")),
      }}
      mobileCards
      breakpoint="xl"
      renderCard={(row) => {
        const phase = normalizeItpPhase(row.phase);
        return (
          <Link
            prefetch={false}
            href={hrefFor(row.id)}
            scroll={false}
            aria-current={row.id === selectedId ? "page" : undefined}
            className="-mx-4 -my-3 block space-y-2 px-4 py-3 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-burgundy"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="doc-id text-base font-semibold text-burgundy">{row.itp_number}</span>
              <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"} showIcon>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>
            </span>
            <span className="line-clamp-2 block text-sm text-ink [overflow-wrap:anywhere]">{row.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {row.projects?.name && <span className="min-w-0 truncate">{row.projects.name}</span>}
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap"><Tx>Rev</Tx> {row.revision}</span>
              <Badge tone={ITP_PHASE_TONE[phase]} showIcon={false}>{ITP_PHASE_LABEL[phase]}</Badge>
            </span>
            <ProgressCell progress={row.progress} />
          </Link>
        );
      }}
      searchPlaceholder="Search by ITP number, title or project…"
      searchKeys={(row) => `${row.itp_number} ${row.title}`}
      emptyMessage={searchValue ? "No ITPs match your search." : "No ITPs yet."}
      serverSearch={serverDriven ? { value: searchValue, onChange: setSearchValue } : undefined}
      pagination={
        serverDriven
          ? {
              page,
              pageSize: PAGE_SIZE,
              totalCount: totalCount!,
              onPageChange: goToPage,
            }
          : undefined
      }
    />
  );
}
