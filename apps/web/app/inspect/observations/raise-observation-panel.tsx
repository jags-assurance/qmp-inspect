"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NewNcrForm } from "../ncrs/new/new-ncr-form";

/**
 * The one real "less page navigation" win for this register (see plan Phase 2): raising an
 * observation reuses the exact same NewNcrForm + createNcrAction as /inspect/ncrs/new, just opened
 * inline over the register instead of navigating to a separate page. Severity still defaults to
 * "Observation" (NCR_SEVERITIES[0]) and remains fully editable, same as today.
 */
export function RaiseObservationPanel({
  projects,
  peopleByProject,
  partiesByProject,
}: {
  projects: { id: string; project_number: string; name: string }[];
  peopleByProject: Record<string, { id: string; name: string }[]>;
  partiesByProject: Record<string, { id: string; name: string; party_type: string }[]>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Raise Observation</Button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Raise Observation</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-sm text-muted hover:bg-off-white hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-muted">
              The register stays open behind this panel — closing it (or submitting) returns you here.
            </p>
            <NewNcrForm
              projects={projects}
              peopleByProject={peopleByProject}
              partiesByProject={partiesByProject}
            />
          </div>
        </div>
      )}
    </>
  );
}
