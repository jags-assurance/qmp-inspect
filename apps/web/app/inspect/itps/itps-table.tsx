"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useServerDrivenTableParams } from "@/lib/hooks/use-server-driven-table-params";
import { ITP_TABLE_PAGE_SIZE as PAGE_SIZE } from "./constants";
import { ITP_PHASE_LABEL, ITP_PHASE_TONE, normalizeItpPhase } from "@/lib/itps/phase";

export interface ItpRow {
  id: string;
  itp_number: string;
  title: string;
  status: string;
  revision: number;
  phase: string;
  projects: { name: string } | null;
}

// Exported so other pages rendering the same ITP status enum (e.g.
// app/inspect/itps/[id]/checklists/page.tsx) can reuse this instead of duplicating a copy.
export const ITP_STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
};

export const ITP_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

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
            className={`-mx-2 -my-1.5 block min-w-0 rounded-md border-l-2 px-2 py-2 hover:bg-off-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-burgundy ${row.id === selectedId ? "border-burgundy bg-off-white" : "border-transparent"}`}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className={`doc-id text-sm text-burgundy ${row.id === selectedId ? "font-semibold" : ""}`}>{row.itp_number}</span>
                <span className="text-xs text-muted">Rev {row.revision}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap">
                <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"}>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>
              </span>
            </span>
            <span className="mt-1 line-clamp-2 block break-words text-sm text-ink" title={row.title}>{row.title}</span>
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
    render: (row) => (
      <Link prefetch={false} href={hrefFor(row.id)} scroll={false} aria-current={cur(row.id)} className={`doc-id inline-flex min-h-11 items-center text-burgundy hover:underline ${row.id === selectedId ? "font-semibold" : ""}`}>
        {row.itp_number}
      </Link>
    ),
  },
  {
    key: "title",
    header: "Title",
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
    render: (row) => <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"}>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>,
  },
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
export function ItpsTable({ rows, totalCount }: { rows: ItpRow[]; totalCount?: number }) {
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("itp");
  const columns = useMemo(
    () =>
      buildColumns((id) => {
        const p = new URLSearchParams(searchParams.toString());
        p.set("itp", id);
        p.delete("pane");
        return `?${p.toString()}`;
      }, selectedId),
    [searchParams, selectedId]
  );
  const serverDriven = totalCount !== undefined;
  const { searchValue, setSearchValue, page, goToPage } = useServerDrivenTableParams(serverDriven);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search ITPs…"
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
