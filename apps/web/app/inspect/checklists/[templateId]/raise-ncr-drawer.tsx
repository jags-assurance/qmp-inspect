"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { SidePanel, Toast, useToast } from "@/components/ui/side-panel";
import { loadRaiseOptionsAction } from "@/lib/ncrs/raise-options-actions";
import type { RaiseOptions } from "@/lib/ncrs/raise-options";
import { NewNcrForm } from "../../ncrs/new/new-ncr-form";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * "Raise NCR for this item" without leaving the inspection: opens the same NewNcrForm a failed item
 * used to link out to, pre-filled with the project, ITP item, inspection record and the inspector's
 * comment, in a side panel over the checklist. The answers already entered stay on screen; the NCR
 * is still linked to the item and record exactly as before (same createNcrAction).
 */
export function RaiseNcrDrawer({
  projectId,
  itpItemId,
  inspectionRecordId,
  checklistItemId,
  initialDescription,
}: {
  projectId: string;
  itpItemId: string;
  inspectionRecordId: string;
  /** The checklist item the NCR is raised from; stored on the NCR so the "No" answer is traceable. */
  checklistItemId?: string;
  initialDescription: string;
}) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RaiseOptions | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { message, show, dismiss } = useToast();

  async function openPanel() {
    setOpen(true);
    if (options) return;
    setLoadError(false);
    try {
      setOptions(await loadRaiseOptionsAction());
    } catch {
      setLoadError(true);
    }
  }

  const handleCreated = useCallback(
    (created: { id: string; ncrNumber: string }) => {
      setOpen(false);
      show(
        <>
          {created.ncrNumber} <Tx>raised and linked to this item.</Tx>{" "}
          <Link href={`/inspect/ncrs/${created.id}`} className="font-medium underline">
            <Tx>View it →</Tx>
          </Link>
        </>
      );
    },
    [show]
  );

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="inline-flex min-h-11 items-center font-medium underline hover:no-underline"
      >
        <Tx>Raise NCR for this item →</Tx>
      </button>
      <SidePanel
        open={open}
        onClose={() => setOpen(false)}
        title={tl("Raise NCR for this item")}
        description="Linked to this checklist item and inspection. Your answers stay on screen behind this panel."
        width="lg"
      >
        {loadError ? (
          <p className="mt-6 text-sm text-danger"><Tx>Couldn&rsquo;t load the form options. Close and try again.</Tx></p>
        ) : !options ? (
          <p className="mt-6 text-sm text-muted"><Tx>Loading…</Tx></p>
        ) : (
          <NewNcrForm
            projects={options.projects}
            peopleByProject={options.peopleByProject}
            partiesByProject={options.partiesByProject}
            initialProjectId={projectId}
            itpItemId={itpItemId}
            inspectionRecordId={inspectionRecordId}
            checklistItemId={checklistItemId}
            initialDescription={initialDescription}
            onCreated={handleCreated}
          />
        )}
      </SidePanel>
      <Toast message={message} onDismiss={dismiss} />
    </>
  );
}
