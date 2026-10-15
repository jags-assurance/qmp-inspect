"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tx } from "@/components/domain/tx";
import { buttonVariants } from "@/components/ui/button";

export interface CompareRevisionRow {
  id: string;
  title: string;
  documentNumber: string | null;
  revision: string;
  status: string;
  documentDate: string | null;
  notes: string | null;
  createdAt: string;
  uploaderName: string | null;
  url: string | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  approved: "success",
  for_review: "warning",
  superseded: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  for_review: "For review",
  superseded: "Superseded",
};

function RevisionColumn({
  label,
  revisions,
  selectedId,
  onChange,
}: {
  label: string;
  revisions: CompareRevisionRow[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const revision = revisions.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <label className="block text-xs font-medium text-muted">{label}</label>
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy sm:text-sm"
      >
        {revisions.map((r) => (
          <option key={r.id} value={r.id}>
            <Tx>Rev.</Tx> {r.revision} — {new Date(r.createdAt).toLocaleDateString("en-GB")}
          </option>
        ))}
      </select>

      {revision && (
        <div className="mt-4 space-y-3">
          <Badge tone={STATUS_TONE[revision.status] ?? "neutral"}>{STATUS_LABEL[revision.status] ?? revision.status}</Badge>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted"><Tx>Document No.</Tx></dt>
              <dd className="doc-id text-ink">{revision.documentNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted"><Tx>Title</Tx></dt>
              <dd className="text-ink">{revision.title}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted"><Tx>Document date</Tx></dt>
              <dd className="text-ink">
                {revision.documentDate ? new Date(revision.documentDate).toLocaleDateString("en-GB") : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted"><Tx>Uploaded</Tx></dt>
              <dd className="text-ink">
                {new Date(revision.createdAt).toLocaleDateString("en-GB")}
                {revision.uploaderName ? ` by ${revision.uploaderName}` : ""}
              </dd>
            </div>
            {revision.notes && (
              <div>
                <dt className="text-xs text-muted"><Tx>Notes</Tx></dt>
                <dd className="text-ink">{revision.notes}</dd>
              </div>
            )}
          </dl>
          {revision.url ? (
            <a
              href={revision.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "md", className: "w-full sm:w-auto" })}
            >
              <Tx>Open file ↗</Tx>
            </a>
          ) : (
            <p className="text-xs text-muted"><Tx>File preview unavailable.</Tx></p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Two independent pickers over the same revision list, defaulting to the two most recent revisions
 * (or, arriving from a specific document's "Compare revisions" link, that document vs. the one
 * immediately before it) — nothing here mutates data, this is a read-only side-by-side view.
 */
export function RevisionCompare({
  revisions,
  initialRightId,
}: {
  revisions: CompareRevisionRow[];
  initialRightId: string;
}) {
  const rightIndex = revisions.findIndex((r) => r.id === initialRightId);
  const safeRightIndex = rightIndex === -1 ? revisions.length - 1 : rightIndex;
  const leftIndex = safeRightIndex > 0 ? safeRightIndex - 1 : Math.max(0, revisions.length - 2);

  const [leftId, setLeftId] = useState(revisions[leftIndex]?.id ?? "");
  const [rightId, setRightId] = useState(revisions[safeRightIndex]?.id ?? "");

  if (revisions.length < 2) {
    return (
      <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
        <Tx>This document has no other revisions to compare against yet.</Tx>
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <RevisionColumn label="Comparing" revisions={revisions} selectedId={leftId} onChange={setLeftId} />
      <RevisionColumn label="Against" revisions={revisions} selectedId={rightId} onChange={setRightId} />
    </div>
  );
}
