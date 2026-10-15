"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/lib/i18n/locale-context";
import { OrgSwitcher } from "./org-switcher";
import { GlobalProjectSelector, type ProjectSelectorOption } from "./global-project-selector";

/**
 * The header "context" control: which organisation / project the user is working in.
 *  - laptop and up (lg): inline compact selects in the header row (max-widths, truncated text).
 *  - below lg: ONE 44px button (icon on phones, icon + current project on tablets) that opens a
 *    bottom sheet holding the same fields at full width. The header therefore never grows.
 */
export function HeaderContext({
  orgSwitcher,
  projectSelector,
  setActiveOrganisationAction,
  setActiveProjectAction,
}: {
  orgSwitcher: { options: { id: string; name: string }[]; activeId: string | null } | null;
  projectSelector: { options: ProjectSelectorOption[]; activeId: string | null } | null;
  setActiveOrganisationAction: (formData: FormData) => void | Promise<void>;
  setActiveProjectAction: (formData: FormData) => void | Promise<void>;
}) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const showOrg = !!orgSwitcher && orgSwitcher.options.length > 1;
  if (!showOrg && !projectSelector) return null;

  const active = projectSelector?.options.find((o) => o.id === projectSelector.activeId);
  const orgName = showOrg ? orgSwitcher!.options.find((o) => o.id === orgSwitcher!.activeId)?.name : undefined;
  const label = active ? active.number : (orgName ?? tl("All projects"));

  return (
    <>
      <div className="hidden items-center gap-2 lg:flex">
        {showOrg && (
          <OrgSwitcher options={orgSwitcher!.options} activeId={orgSwitcher!.activeId} action={setActiveOrganisationAction} idPrefix="inline" />
        )}
        {projectSelector && (
          <GlobalProjectSelector options={projectSelector.options} activeId={projectSelector.activeId} action={setActiveProjectAction} idPrefix="inline" />
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${tl("Organisation and project")}: ${active ? `${active.number} — ${active.name}` : tl("All projects")}`}
        className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-ink hover:bg-surface-subtle sm:px-3 lg:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-muted">
          <path d="M2.5 6.5A1.5 1.5 0 014 5h3.2c.4 0 .8.2 1.1.5L9.4 7H16a1.5 1.5 0 011.5 1.5v6A1.5 1.5 0 0116 16H4a1.5 1.5 0 01-1.5-1.5v-8z" />
        </svg>
        <span className="doc-id hidden max-w-[9rem] truncate sm:inline">{label}</span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={tl("Organisation and project")}
        description={tl("Pages and filters default to what you pick here.")}
        footer={
          <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(false)}>
            {tl("Close")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {showOrg && (
            <OrgSwitcher
              variant="stacked"
              options={orgSwitcher!.options}
              activeId={orgSwitcher!.activeId}
              action={setActiveOrganisationAction}
              idPrefix="sheet"
              onChanged={() => setOpen(false)}
            />
          )}
          {projectSelector && (
            <GlobalProjectSelector
              variant="stacked"
              options={projectSelector.options}
              activeId={projectSelector.activeId}
              action={setActiveProjectAction}
              idPrefix="sheet"
              onChosen={() => setOpen(false)}
            />
          )}
        </div>
      </Sheet>
    </>
  );
}
