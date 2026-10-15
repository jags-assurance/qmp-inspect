"use client";

import { formatLocationForDisplay } from "@/lib/checklists/location";
import { SidePanel, useUrlPanel } from "@/components/ui/side-panel";
import { TabStrip, useUrlTab } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  PUNCH_LIST_SOURCE_LABELS,
  type PunchListPriority,
  type PunchListSource,
  type PunchListStatus,
} from "@/lib/punch-list/types";
import { useState } from "react";
import { csvCell, csvLine, isPunchOverdue } from "@/lib/punch-list/helpers";
import { EditPunchItemForm } from "./edit-punch-item-form";
import { ReopenPunchItemForm } from "./reopen-punch-item-form";
import { ResolvePunchItemForm } from "./resolve-punch-item-form";
import { VerifyClosePunchItemForm } from "./verify-close-punch-item-form";
import { BulkPunchBar, WithdrawPunchItemForm } from "./punch-extras";
import Link from "next/link";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

export interface PunchListItemDisplayRow {
  id: string;
  description: string;
  source: PunchListSource;
  location: string | null;
  due_date: string | null;
  status: PunchListStatus;
  project_parties: { name: string; user_id: string | null } | null;
  /** Captured by ResolvePunchItemForm's "Mark resolved" step, but previously never shown anywhere
   *  again afterward — including to the verifier deciding whether to close it. */
  closing_evidence: string | null;
  verification_notes: string | null;
  priority: PunchListPriority;
  photo_paths: string[] | null;
  photo_urls: string[];
  reopen_reason: string | null;
  reopen_count: number | null;
  responsible_party_id: string | null;
  closing_photo_paths: string[] | null;
  closing_photo_urls: string[];
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  source_ncr_id?: string | null;
  source_inspection_record_id?: string | null;
  source_standalone_assignment_id?: string | null;
}


const STATUS_TONE: Record<PunchListStatus, "success" | "neutral" | "warning"> = {
  open: "neutral",
  resolved: "warning",
  closed: "success",
};

const PUNCH_LIST_STATUS_LABELS: Record<PunchListStatus, string> = {
  open: "Open",
  resolved: "Resolved — awaiting verification",
  closed: "Closed",
};

// Functions (render) can't cross the server -> client boundary as props from a Server Component —
// this wrapper exists so the Server Component page only ever passes plain, serializable row data
// down, same pattern as ProjectsTable/NcrsTable.
const VIEWS = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "open", label: "Open" },
  { key: "verify", label: "Needs verification" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export function PunchListTable({
  projectId,
  rows,
  canVerifyClose,
  isAdmin = false,
  currentUserId,
  projectParties,
  exportName,
  timeZone,
}: {
  projectParties: { id: string; name: string }[];
  exportName: string;
  /** The project's IANA zone: Overdue is judged on the site day. */
  timeZone?: string | null;
  projectId: string;
  rows: PunchListItemDisplayRow[];
  /** Whether THIS viewer can do the independent verify-and-close step (JAGS Admin, or a
   *  close_punch_item permission holder) — computed once on the server page, not re-derived here. */
  canVerifyClose: boolean;
  /** JAGS Admin: may use the audited "Close as admin" override on an item they resolved. */
  isAdmin?: boolean;
  /** "Mine" = items whose responsible party is the one linked to this viewer's own login. */
  currentUserId: string;
}) {
  const tl = useTranslate();
  const isOverdueRow = (r: { due_date: string | null; status: string }) => isPunchOverdue(r, new Date(), timeZone);
  const panel = useUrlPanel("item");
  const [view, setView] = useUrlTab<ViewKey>("view", VIEWS.map((v) => v.key));
  const counts = {
    all: rows.length,
    mine: rows.filter((r) => r.project_parties?.user_id === currentUserId).length,
    open: rows.filter((r) => r.status === "open").length,
    verify: rows.filter((r) => r.status === "resolved").length,
  };
  const [selected, setSelected] = useState<string[]>([]);
  const toggleSelected = (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  const [partyFilter, setPartyFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const overdueCount = rows.filter(isOverdueRow).length;
  const visibleRows = rows
    .filter((r) => !partyFilter || (partyFilter === "none" ? !r.responsible_party_id : r.responsible_party_id === partyFilter))
    .filter((r) => !priorityFilter || r.priority === priorityFilter)
    .filter((r) => !locationFilter || (r.location ?? "").toLowerCase().includes(locationFilter.toLowerCase()))
    .filter((r) => (view === "open"
      ? r.status === "open"
      : view === "verify"
        ? r.status === "resolved"
        : view === "mine"
          ? r.project_parties?.user_id === currentUserId
          : true));

  function exportCsv(all: boolean) {
    const source = all ? rows : visibleRows;
    const header = ["Priority", "Description", "Source", "Location", "Responsible party", "Due", "Overdue", "Status", "Closing evidence", "Closing photos", "Photos", "Resolved by", "Resolved on", "Verification notes", "Closed by", "Closed on", "Reopen count", "Reopen reason"];
    const day = (v: string | null) => (v ? v.slice(0, 10) : "");
    const lines = source.map((r) =>
      csvLine([
        r.priority,
        r.description,
        PUNCH_LIST_SOURCE_LABELS[r.source],
        formatLocationForDisplay(r.location) ?? "",
        r.project_parties?.name ?? "",
        r.due_date ?? "",
        isOverdueRow(r) ? "Yes" : "No",
        r.status,
        r.closing_evidence ?? "",
        (r.closing_photo_paths ?? []).length,
        (r.photo_paths ?? []).length,
        r.resolved_by_name ?? "",
        day(r.resolved_at),
        r.verification_notes ?? "",
        r.closed_by_name ?? "",
        day(r.closed_at),
        r.reopen_count ?? 0,
        r.reopen_reason ?? "",
      ])
    );
    const blob = new Blob(["\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}${all ? "-all" : "-filtered"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const openRow = panel.value ? rows.find((r) => r.id === panel.value) : undefined;

  // The resolve / verify forms used to expand inside the table cell and shove every row around;
  // they now live in a side panel opened per row, so the list stays still and context stays visible.
  const columns: DataTableColumn<PunchListItemDisplayRow>[] = [
    ...(canVerifyClose
      ? [
          {
            key: "select",
            header: "",
            render: (row: PunchListItemDisplayRow) =>
              row.status === "closed" ? null : (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.description.slice(0, 40)}`}
                  checked={selected.includes(row.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelected(row.id)}
                  className="h-5 w-5"
                />
              ),
          },
        ]
      : []),
    {
      key: "priority",
      header: "Pri.",
      render: (row) => <Badge tone={row.priority === "A" ? "danger" : row.priority === "B" ? "warning" : "neutral"}>{row.priority}</Badge>,
    },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <span className="line-clamp-2 max-w-xs [overflow-wrap:anywhere]" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (row) => <Badge tone="neutral">{PUNCH_LIST_SOURCE_LABELS[row.source]}</Badge>,
    },
    { key: "location", header: "Location", render: (row) => formatLocationForDisplay(row.location) },
    {
      key: "responsible_party",
      header: "Responsible party",
      render: (row) => row.project_parties?.name ?? "—",
    },
    {
      key: "due_date",
      header: "Due",
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          {row.due_date ? new Date(row.due_date).toLocaleDateString("en-GB") : "—"}
          {isOverdueRow(row) && <Badge tone="danger"><Tx>Overdue</Tx></Badge>}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={STATUS_TONE[row.status]} showIcon>{PUNCH_LIST_STATUS_LABELS[row.status]}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <Button
          type="button"
          onClick={() => panel.open(row.id)}
          variant="link"
        >
          {row.status === "open" ? "Resolve" : row.status === "resolved" && canVerifyClose ? "Verify" : "Details"}
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3">
        <TabStrip
          tabs={VIEWS.map((v) => ({ key: v.key, label: `${v.label} (${counts[v.key]})` }))}
          active={view}
          onSelect={setView}
          label="Punch list view"
          idPrefix="punch-view"
        />
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1 text-muted">
          <Tx>Responsible party</Tx>
          <select value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            <option value=""><Tx>All</Tx></option>
            <option value="none"><Tx>Unassigned</Tx></option>
            {projectParties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-muted">
          <Tx>Priority</Tx>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm text-ink">
            <option value=""><Tx>All</Tx></option>
            <option value="A"><Tx>A</Tx></option>
            <option value="B"><Tx>B</Tx></option>
            <option value="C"><Tx>C</Tx></option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-muted">
          <Tx>Location</Tx>
          <input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder={tl("Contains…")} className="min-h-11 w-36 rounded-md border border-border bg-surface px-2 text-sm text-ink" />
        </label>
        {overdueCount > 0 && <Badge tone="danger">{overdueCount} <Tx>overdue</Tx></Badge>}
        <div className="no-print ms-auto flex gap-2">
          <Button type="button" onClick={() => exportCsv(false)} variant="outline">
            <Tx>Export filtered (</Tx>{visibleRows.length})
          </Button>
          <Button type="button" onClick={() => exportCsv(true)} variant="outline">
            <Tx>Export all (</Tx>{rows.length})
          </Button>
          <Button type="button" onClick={() => window.print()} variant="outline">
            <Tx>Print</Tx>
          </Button>
        </div>
      </div>
      {canVerifyClose && <BulkPunchBar projectId={projectId} selectedIds={selected} parties={projectParties} onDone={() => setSelected([])} />}
      {/* Only .print-area survives @media print (globals.css): the heading + table, not the filters/buttons. */}
      <div className="print-area">
        <h1 className="mb-3 hidden text-xl font-semibold text-ink print:block">
          <Tx>Punch list ·</Tx> {visibleRows.length} <Tx>item</Tx>{visibleRows.length === 1 ? "" : "s"} · {new Date().toLocaleDateString("en-GB")}
        </h1>
      <DataTable
        columns={columns}
        rows={visibleRows}
        caption="Punch list items"
        mobileCards
        searchPlaceholder="Search punch list…"
        searchKeys={(row) => `${row.description} ${row.location ?? ""} ${row.project_parties?.name ?? ""}`}
        emptyMessage={view === "all" && !partyFilter && !priorityFilter && !locationFilter ? "No punch list items yet. Use Record walk-down or Add punch item above." : "Nothing matches these filters."}
      />
      </div>
      <SidePanel open={!!openRow} onClose={panel.close} title={tl("Punch list item")}>
        {openRow && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-ink">{openRow.description}</p>
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[openRow.status]} showIcon>{PUNCH_LIST_STATUS_LABELS[openRow.status]}</Badge>
              <Badge tone="neutral">{PUNCH_LIST_SOURCE_LABELS[openRow.source]}</Badge>
              {openRow.source_ncr_id && (
                <Link href={`/inspect/ncrs/${openRow.source_ncr_id}`} className="text-xs text-burgundy hover:underline">
                  <Tx>Open the NCR →</Tx>
                </Link>
              )}
              {openRow.source_inspection_record_id && (
                <Link href={`/inspect/inspections/${openRow.source_inspection_record_id}`} className="text-xs text-burgundy hover:underline">
                  <Tx>Open the inspection →</Tx>
                </Link>
              )}
              {openRow.source_standalone_assignment_id && (
                <Link href={`/inspect/standalone/${openRow.source_standalone_assignment_id}`} className="text-xs text-burgundy hover:underline">
                  <Tx>Open the assignment →</Tx>
                </Link>
              )}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted"><Tx>Location</Tx></dt>
              <dd className="text-ink">{formatLocationForDisplay(openRow.location)}</dd>
              <dt className="text-muted"><Tx>Responsible party</Tx></dt>
              <dd className="text-ink">{openRow.project_parties?.name ?? "—"}</dd>
              <dt className="text-muted"><Tx>Priority</Tx></dt>
              <dd className="text-ink">{openRow.priority}</dd>
              <dt className="text-muted"><Tx>Due</Tx></dt>
              <dd className="text-ink">{openRow.due_date ? new Date(openRow.due_date).toLocaleDateString("en-GB") : "—"}</dd>
            </dl>
            {openRow.reopen_reason && (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-ink">
                <Tx>Reopened</Tx>{openRow.reopen_count && openRow.reopen_count > 1 ? ` (${openRow.reopen_count}x)` : ""}: {openRow.reopen_reason}
              </p>
            )}
            {openRow.photo_urls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {openRow.photo_urls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="Punch item photo" className="h-20 w-20 rounded-md border border-border object-cover" />
                  </a>
                ))}
              </div>
            )}
            {openRow.closing_photo_urls.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Photos of the fix</Tx></p>
                <div className="flex flex-wrap gap-2">
                  {openRow.closing_photo_urls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="Photo of the fix" className="h-20 w-20 rounded-md border border-border object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {canVerifyClose && openRow.status !== "closed" && (
              <EditPunchItemForm
                key={openRow.id}
                projectId={projectId}
                punchItemId={openRow.id}
                projectParties={projectParties}
                current={{ responsible_party_id: openRow.responsible_party_id, due_date: openRow.due_date, priority: openRow.priority, location: openRow.location }}
              />
            )}
            {openRow.status === "closed" && (
              <div className="space-y-2">
                <div className="rounded-md border border-border bg-off-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Resolver&rsquo;s evidence</Tx></p>
                  <p className="mt-0.5 text-sm text-ink">{openRow.closing_evidence || "—"}</p>
                </div>
                <div className="rounded-md border border-border bg-off-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Verification notes</Tx></p>
                  <p className="mt-0.5 text-sm text-ink">{openRow.verification_notes || "—"}</p>
                </div>
                {openRow.resolved_by_name && <p className="text-xs text-muted"><Tx>Resolved by</Tx> {openRow.resolved_by_name}<Tx>; closed by</Tx> {openRow.closed_by_name ?? "unknown"}.</p>}
                {canVerifyClose && <ReopenPunchItemForm projectId={projectId} punchItemId={openRow.id} label="Reopen closed item" />}
              </div>
            )}
            {openRow.status === "open" && <ResolvePunchItemForm projectId={projectId} punchItemId={openRow.id} />}
            {openRow.status !== "closed" && !openRow.source_ncr_id && <WithdrawPunchItemForm projectId={projectId} punchItemId={openRow.id} />}
            {openRow.status === "resolved" && (
              <div className="space-y-2">
                <div className="rounded-md border border-border bg-off-white px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Resolver&rsquo;s evidence</Tx></p>
                  <p className="mt-0.5 text-sm text-ink">{openRow.closing_evidence || "—"}</p>
                </div>
                {canVerifyClose ? (
                  <>
                    <VerifyClosePunchItemForm projectId={projectId} punchItemId={openRow.id} isAdmin={isAdmin} />
                    <ReopenPunchItemForm projectId={projectId} punchItemId={openRow.id} label="Reject fix - send back to open" />
                  </>
                ) : (
                  <p className="text-xs text-muted"><Tx>Awaiting verification by a JAGS Admin or someone granted the close punch item permission (not the person who resolved it).</Tx></p>
                )}
              </div>
            )}
          </div>
        )}
      </SidePanel>
    </>
  );
}
