"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslate } from "@/lib/i18n/locale-context";
import { cn } from "@/lib/cn";

export interface ProjectSelectorOption {
  id: string;
  number: string;
  name: string;
  orgId: string;
  orgName: string;
}

/** Pages whose list/filter reads `?project=`; picking a project in the header updates it in place. */
const FILTER_PAGES = [
  "/inspect/vault",
  "/inspect/ncrs",
  "/inspect/observations",
  "/inspect/inspections",
  "/inspect/start-work",
  "/inspect/standalone",
  "/inspect/itps",
  "/inspect/reports-documents",
];

const PROJECT_PAGE = /^\/inspect\/projects\/[0-9a-f-]{36}(\/.*)?$/i;

/**
 * The "which organisation / project am I working on" fields. Picking a project remembers it (cookie,
 * via `action`) so every project dropdown and filter defaults to it, and re-points the page you are
 * on: filter pages get `?project=`, a project's own pages switch to the new project. An organisation
 * picker appears when the visible projects span more than one organisation (staff and
 * multi-organisation logins) and narrows the project list. "All projects" clears the selection.
 *
 * `variant="inline"` renders two compact 36px selects with max-widths for the header row (laptop and
 * up); `variant="stacked"` renders full-width labelled 44px fields for the context sheet on narrower
 * screens. `idPrefix` keeps ids unique when both variants are mounted.
 */
export function GlobalProjectSelector({
  options,
  activeId,
  action,
  variant = "inline",
  idPrefix = "global",
  onChosen,
}: {
  options: ProjectSelectorOption[];
  activeId: string | null;
  action: (formData: FormData) => void | Promise<void>;
  variant?: "inline" | "stacked";
  idPrefix?: string;
  /** Called after a project has been chosen (the sheet uses it to close itself). */
  onChosen?: () => void;
}) {
  const tl = useTranslate();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const orgs = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.orgId, o.orgName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [options]);
  const activeOrg = options.find((o) => o.id === activeId)?.orgId ?? "";
  const [orgFilter, setOrgFilter] = useState(activeOrg);
  const shown = orgFilter ? options.filter((o) => o.orgId === orgFilter) : options;

  function choose(projectId: string) {
    const fd = new FormData();
    fd.set("project_id", projectId);
    startTransition(async () => {
      await action(fd);
      if (PROJECT_PAGE.test(pathname) && projectId) {
        router.push(pathname.replace(/^(\/inspect\/projects\/)[0-9a-f-]{36}/i, `$1${projectId}`));
      } else if (FILTER_PAGES.some((p) => pathname === p)) {
        const next = new URLSearchParams(search.toString());
        next.set("project", projectId); // "" = All projects, which must beat the remembered default
        next.delete("page");
        router.push(`${pathname}?${next.toString()}`);
      } else {
        router.refresh();
      }
      onChosen?.();
    });
  }

  if (options.length === 0) return null;
  const stacked = variant === "stacked";
  const selectCls = stacked
    ? "min-h-11 w-full min-w-0 truncate rounded-md border border-border bg-surface px-3 text-base text-ink disabled:opacity-60"
    : "h-9 [@media(pointer:coarse)]:h-11 min-w-0 max-w-[10rem] truncate rounded-md border border-border bg-surface px-2.5 text-sm text-ink hover:bg-surface-subtle disabled:opacity-60 xl:max-w-[13rem] desk:max-w-[18rem]";
  const orgId = `${idPrefix}-org-filter`;
  const projectId = `${idPrefix}-project-select`;
  const orgField = orgs.length > 1 && (
    <>
      <label className={stacked ? "text-sm font-medium text-ink" : "sr-only"} htmlFor={orgId}>{tl("Organisation")}</label>
      <select
        id={orgId}
        value={orgFilter}
        disabled={pending}
        onChange={(e) => {
          const org = e.target.value;
          setOrgFilter(org);
          // The selected project no longer belongs to this organisation: clear it.
          if (activeId && org && options.find((o) => o.id === activeId)?.orgId !== org) choose("");
        }}
        className={selectCls}
      >
        <option value="">{tl("All organisations")}</option>
        {orgs.map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </select>
    </>
  );
  const projectSelect = (
    <select
      id={projectId}
      value={activeId && shown.some((o) => o.id === activeId) ? activeId : ""}
      disabled={pending}
      onChange={(e) => choose(e.target.value)}
      className={selectCls}
    >
      <option value="">{tl("All projects")}</option>
      {shown.map((o) => (
        <option key={o.id} value={o.id}>{`${o.number} — ${o.name}`}</option>
      ))}
    </select>
  );
  return (
    <div className={cn(stacked ? "flex flex-col gap-2" : "flex items-center gap-2")} aria-busy={pending}>
      {orgField && (stacked ? <div className="flex flex-col gap-1.5">{orgField}</div> : orgField)}
      {stacked ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink" htmlFor={projectId}>{tl("Project")}</label>
          {projectSelect}
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor={projectId}>{tl("Project")}</label>
          {projectSelect}
        </>
      )}
    </div>
  );

}
