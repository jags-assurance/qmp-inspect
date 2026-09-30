"use client";

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
  project_parties: { name: string } | null;
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
export function PunchListTable({
  projectId,
  rows,
  canVerifyClose,
}: {
  projectId: string;
  rows: PunchListItemDisplayRow[];
  /** Whether THIS viewer can do the independent verify-and-close step (JAGS Admin, or a
   *  close_punch_item permission holder) — computed once on the server page, not re-derived here. */
  canVerifyClose: boolean;
}) {
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
      render: (row) => {
        if (row.status === "open") return <ResolvePunchItemForm projectId={projectId} punchItemId={row.id} />;
        if (row.status === "resolved") {
          return (
            <div className="flex min-w-56 flex-col gap-1.5">
              <div className="rounded-md border border-border bg-off-white px-2 py-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Resolver's evidence</p>
                <p className="mt-0.5 text-xs text-ink">{row.closing_evidence || "—"}</p>
              </div>
              {canVerifyClose ? (
                <VerifyClosePunchItemForm projectId={projectId} punchItemId={row.id} />
              ) : (
                <span className="text-xs text-muted">Awaiting verification</span>
              )}
            </div>
          );
        }
        return null;
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchPlaceholder="Search punch list…"
      searchKeys={(row) => `${row.description} ${row.location ?? ""} ${row.project_parties?.name ?? ""}`}
      emptyMessage="No punch list items yet."
    />
  );
}
