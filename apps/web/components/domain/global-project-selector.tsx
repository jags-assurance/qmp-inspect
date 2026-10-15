"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslate } from "@/lib/i18n/locale-context";

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
 * One header control for "which organisation / project am I working on". Picking a project remembers
 * it (cookie, via `action`) so every project dropdown and filter defaults to it, and re-points the
 * page you are on: filter pages get `?project=`, a project's own pages switch to the new project.
 * An organisation picker appears when the visible projects span more than one organisation (staff and
 * multi-organisation logins) and narrows the project list. "All projects" clears the selection.
 */
export function GlobalProjectSelector({
  options,
  activeId,
  action,
}: {
  options: ProjectSelectorOption[];
  activeId: string | null;
  action: (formData: FormData) => void | Promise<void>;
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
    });
  }

  if (options.length === 0) return null;
  const selectCls =
    "min-h-11 max-w-48 truncate rounded-md border border-border bg-surface px-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-burgundy disabled:opacity-60";
  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      {orgs.length > 1 && (
        <>
          <label className="sr-only" htmlFor="global-org-filter">{tl("Organisation")}</label>
          <select
            id="global-org-filter"
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
      )}
      <label className="sr-only" htmlFor="global-project-select">{tl("Project")}</label>
      <select
        id="global-project-select"
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
    </div>
  );
}
