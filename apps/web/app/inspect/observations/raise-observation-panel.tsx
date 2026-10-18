"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SidePanel, Toast, useToast, useUrlPanel } from "@/components/ui/side-panel";
import { loadRaiseOptionsAction } from "@/lib/ncrs/raise-options-actions";
import type { RaiseOptions } from "@/lib/ncrs/raise-options";
import { NewNcrForm } from "../ncrs/new/new-ncr-form";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Raising an observation without leaving the register: the same NewNcrForm + createNcrAction as
 * /inspect/ncrs/new, opened in the shared SidePanel. Open state lives in the URL (`?raise=1`) so the
 * Back button closes the panel and a refresh keeps it open; the people/party lists are fetched only
 * when the panel actually opens. After submitting, the user stays on the register, the new row
 * appears (the action revalidates it) and a toast links to the new record.
 */
export function RaiseObservationPanel() {
  const tl = useTranslate();
  const router = useRouter();
  const panel = useUrlPanel("raise");
  const isOpen = panel.value !== null;
  const { message, show, dismiss } = useToast();

  const [options, setOptions] = useState<RaiseOptions | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Remounts the form after each successful raise so the next one starts blank.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!isOpen || options) return;
    let cancelled = false;
    loadRaiseOptionsAction()
      .then((o) => !cancelled && setOptions(o))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [isOpen, options]);

  const handleCreated = useCallback(
    (created: { id: string; ncrNumber: string }) => {
      panel.close();
      setFormKey((k) => k + 1);
      show(
        <>
          {created.ncrNumber} <Tx>raised.</Tx>{" "}
          <Link href={`/inspect/ncrs/${created.id}`} className="font-medium underline">
            <Tx>View it →</Tx>
          </Link>
        </>
      );
      router.refresh();
    },
    [panel, router, show]
  );

  return (
    <>
      <Button onClick={() => panel.open()} className="min-h-11">
        <Tx>+ Report an issue</Tx>
      </Button>
      <SidePanel
        open={isOpen}
        onClose={panel.close}
        title={tl("Report an issue")}
      >
        {loadError ? (
          <p className="mt-6 text-sm text-danger"><Tx>Couldn&rsquo;t load the project and people lists. Close and try again.</Tx></p>
        ) : !options ? (
          <p className="mt-6 text-sm text-muted"><Tx>Loading…</Tx></p>
        ) : (
          <NewNcrForm
            key={formKey}
            projects={options.projects}
            peopleByProject={options.peopleByProject}
            partiesByProject={options.partiesByProject}
            defaultSeverity="observation"
            lockSeverity
            onCreated={handleCreated}
          />
        )}
      </SidePanel>
      <Toast message={message} onDismiss={dismiss} />
    </>
  );
}
