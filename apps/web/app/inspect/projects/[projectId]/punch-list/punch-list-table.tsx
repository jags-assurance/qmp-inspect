"use client";

import { SidePanel, useUrlPanel } from "@/components/ui/side-panel";
import { TabStrip, useUrlTab } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PUNCH_LIST_SOURCE_LABELS, type PunchListSource, type PunchListStatus } from "@/lib/punch-list/types";
import { ResolvePunchItemForm } from "./resolve-punch-item-form";
import { VerifyClosePunchItemForm } from "./verify-close-punch-item-form";

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
  currentUserId,
}: {
  projectId: string;
  rows: PunchListItemDisplayRow[];
  /** Whether THIS viewer can do the independent verify-and-close step (JAGS Admin, or a
   *  close_punch_item permission holder) — computed once on the server page, not re-derived here. */
  canVerifyClose: boolean;
  /** "Mine" = items whose responsible party is the one linked to this viewer's own login. */
  currentUserId: string;
}) {
  const panel = useUrlPanel("item");
  const [view, setView] = useUrlTab<ViewKey>("view", VIEWS.map((v) => v.key));
  const counts = {
    all: rows.length,
    mine: rows.filter((r) => r.project_parties?.user_id === currentUserId).length,
    open: rows.filter((r) => r.status === "open").length,
    verify: rows.filter((r) => r.status === "resolved").length,
  };
  const visibleRows = rows.filter((r) => (view === "open"
      ? r.status === "open"
      : view === "verify"
        ? r.status === "resolved"
        : view === "mine"
          ? r.project_parties?.user_id === currentUserId
          : true));
  const openRow = panel.value ? rows.find((r) => r.id === panel.value) : undefined;

  // The resolve / verify forms used to expand inside the table cell and shove every row around;
  // they now live in a side panel opened per row, so the list stays still and context stays visible.
  const columns: DataTableColumn<PunchListItemDisplayRow>[] = [
    { key: "description", header: "Description", render: (row) => row.description },
    {
      key: "source",
      header: "Source",
      render: (row) => <Badge tone="neutral">{PUNCH_LIST_SOURCE_LABELS[row.source]}</Badge>,
    },
    { key: "location", header: "Location", render: (row) => row.location ?? "—" },
    {
      key: "responsible_party",
      header: "Responsible party",
      render: (row) => row.project_parties?.name ?? "—",
    },
    {
      key: "due_date",
      header: "Due",
      render: (row) => (row.due_date ? new Date(row.due_date).toLocaleDateString("en-GB") : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{PUNCH_LIST_STATUS_LABELS[row.status]}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <button
          type="button"
          onClick={() => panel.open(row.id)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline"
        >
          {row.status === "open" ? "Resolve" : row.status === "resolved" && canVerifyClose ? "Verify" : "Details"}
        </button>
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
      <DataTable
        columns={columns}
        rows={visibleRows}
        searchPlaceholder="Search punch list…"
        searchKeys={(row) => `${row.description} ${row.location ?? ""} ${row.project_parties?.name ?? ""}`}
        emptyMessage={view === "all" ? "No punch list items yet." : "Nothing in this view."}
      />
      <SidePanel open={!!openRow} onClose={panel.close} title="Punch list item" guardUnsaved={false}>
        {openRow && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-ink">{openRow.description}</p>
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[openRow.status]}>{PUNCH_LIST_STATUS_LABELS[openRow.status]}</Badge>
              <Badge tone="neutral">{PUNCH_LIST_SOURCE_LABELS[openRow.source]}</Badge>
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Location</dt>
              <dd className="text-ink">{openRow.location ?? "—"}</dd>
              <dt className="text-muted">Responsible party</dt>
              <dd className="text-ink">{openRow.project_parties?.name ?? "—"}</dd>
              <dt className="text-muted">Due</dt>
              <dd className="text-ink">{openRow.due_date ? new Date(openRow.due_date).toLocaleDateString("en-GB") : "—"}</dd>
            </dl>
            {openRow.status === "open" && <ResolvePunchItemForm projectId={projectId} punchItemId={openRow.id} />}
            {openRow.status === "resolved" && (
              <div className="space-y-2">
                <div className="rounded-md border border-border bg-off-white px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Resolver&rsquo;s evidence</p>
                  <p className="mt-0.5 text-sm text-ink">{openRow.closing_evidence || "—"}</p>
                </div>
                {canVerifyClose ? (
                  <VerifyClosePunchItemForm projectId={projectId} punchItemId={openRow.id} />
                ) : (
                  <p className="text-xs text-muted">Awaiting verification by someone with close permission.</p>
                )}
              </div>
            )}
          </div>
        )}
      </SidePanel>
    </>
  );
}
