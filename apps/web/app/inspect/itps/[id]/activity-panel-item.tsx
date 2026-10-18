"use client";

import { useEffect, type ReactNode } from "react";
import { SidePanel, useUrlPanel } from "@/components/ui/side-panel";
import { useTranslate } from "@/lib/i18n/locale-context";

const PARAM = "activity";

/**
 * One activity in the ITP list: a single large tap target (the row) that opens the activity's details in
 * the shared right-hand side panel, instead of unfolding a long block inside the list. The open activity is
 * kept in the URL (?activity=<id>) so it can be linked to, survives a refresh, and Back closes it. The panel
 * content (`children`) is only mounted while it is open.
 */
export function ActivityPanelItem({
  id,
  label,
  title,
  description,
  row,
  children,
}: {
  id: string;
  /** Accessible name for the row button, e.g. "Open activity 1.1: Receiving inspection". */
  label: string;
  title: string;
  description?: string;
  row: ReactNode;
  children: ReactNode;
}) {
  const tl = useTranslate();
  const { value, open, close } = useUrlPanel(PARAM);
  const isOpen = value === id;

  // Older links used #activity-<id>: open the same panel for them.
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === `#activity-${id}`) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        open(id);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [id, open]);

  return (
    <>
      <button
        type="button"
        onClick={() => open(id)}
        aria-haspopup="dialog"
        aria-label={`${tl("Open activity")} ${label}`}
        className="flex w-full items-start gap-3 px-3 py-3 text-start hover:bg-surface-subtle focus-visible:bg-surface-subtle sm:px-4 [@media(pointer:coarse)]:min-h-14"
      >
        {row}
      </button>
      <SidePanel open={isOpen} onClose={close} title={title} description={description} width="lg">
        {children}
      </SidePanel>
    </>
  );
}

/** A link that opens an activity's side panel without a page reload (used by the "Needs attention" list). */
export function OpenActivityLink({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const { open } = useUrlPanel(PARAM);
  return (
    <a
      href={`?${PARAM}=${id}`}
      onClick={(e) => {
        e.preventDefault();
        open(id);
      }}
      className={className}
    >
      {children}
    </a>
  );
}
