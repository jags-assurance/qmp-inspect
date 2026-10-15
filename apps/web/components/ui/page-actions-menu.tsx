"use client";

import type { ReactNode } from "react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useTranslate } from "@/lib/i18n/locale-context";

/** The "..." overflow menu PageHeader shows for its secondary actions on phones. */
export function PageActionsMenu({ children }: { children: ReactNode }) {
  const tl = useTranslate();
  return (
    <DropdownMenu
      align="end"
      hideChevron
      ariaLabel={tl("More actions")}
      triggerClassName="w-11 justify-center px-0"
      panelClassName="min-w-[13rem]"
      label={
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <circle cx="4.5" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="15.5" cy="10" r="1.5" />
        </svg>
      }
    >
      <div className="flex flex-col gap-1 p-1 [&>*]:w-full [&>*]:justify-start">{children}</div>
    </DropdownMenu>
  );
}
