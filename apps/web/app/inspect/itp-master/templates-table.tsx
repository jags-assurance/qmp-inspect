"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { FilterBar, FilterField } from "@/components/ui/toolbar";
import { FILTER_CONTROL_CLASS } from "@/components/ui/filter-styles";

export interface MasterTemplateRow {
  id: string;
  title: string;
  industry: string;
  version: number;
  is_active: boolean;
  master_disciplines: { name: string } | null;
}

const COLUMNS: DataTableColumn<MasterTemplateRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => (
      <Link href={`/inspect/itp-master/${row.id}`} className="line-clamp-2 inline-flex min-h-11 max-w-md items-center font-medium text-burgundy hover:underline" title={row.title}>
        {row.title}
      </Link>
    ),
  },
  { key: "industry", header: "Industry", render: (row) => row.industry || "—" },
  { key: "discipline", header: "Discipline", render: (row) => row.master_disciplines?.name ?? "—" },
  { key: "version", header: "Version", render: (row) => `v${row.version}` },
  {
    key: "is_active",
    header: "Status",
    render: (row) => <Badge tone={row.is_active ? "success" : "neutral"} showIcon>{row.is_active ? "Active" : "Inactive"}</Badge>,
  },
];

// Server Component -> Client Component boundary: the page only ever passes plain row data down;
// the column config (which contains render functions) is defined here, already inside client code
// — same pattern as apps/web/app/inspect/projects/projects-table.tsx.
export function TemplatesTable({ rows }: { rows: MasterTemplateRow[] }) {
  const tl = useTranslate();
  const [industry, setIndustry] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [active, setActive] = useState("");
  const industries = [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort();
  const disciplines = [...new Set(rows.map((r) => r.master_disciplines?.name).filter((x): x is string => Boolean(x)))].sort();
  const filtered = rows.filter(
    (r) =>
      (!industry || r.industry === industry) &&
      (!discipline || r.master_disciplines?.name === discipline) &&
      (!active || (active === "active") === r.is_active)
  );
  const sel = FILTER_CONTROL_CLASS;
  const activeCount = [industry, discipline, active].filter(Boolean).length;
  return (
    <div className="space-y-3">
      <FilterBar
        activeCount={activeCount}
        filters={
          <>
        <FilterField label={tl("Industry")}>
        <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={sel}>
          <option value=""><Tx>All industries</Tx></option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        </FilterField>
        <FilterField label={tl("Discipline")}>
        <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className={sel}>
          <option value=""><Tx>All disciplines</Tx></option>
          {disciplines.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        </FilterField>
        <FilterField label={tl("Status")}>
        <select value={active} onChange={(e) => setActive(e.target.value)} className={sel}>
          <option value=""><Tx>Active and inactive</Tx></option>
          <option value="active"><Tx>Active only</Tx></option>
          <option value="inactive"><Tx>Inactive only</Tx></option>
        </select>
        </FilterField>
          </>
        }
      />
    <DataTable
      columns={COLUMNS}
      rows={filtered}
      caption="Master ITP templates"
      breakpoint="md"
      renderCard={(row) => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/inspect/itp-master/${row.id}`} className="inline-flex min-h-11 items-center text-base font-semibold text-burgundy hover:underline [overflow-wrap:anywhere]">
              {row.title}
            </Link>
            <Badge tone={row.is_active ? "success" : "neutral"} showIcon>{row.is_active ? "Active" : "Inactive"}</Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{row.industry || "—"}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate" title={row.master_disciplines?.name ?? ""}>{row.master_disciplines?.name ?? "—"}</span>
            <span aria-hidden="true">·</span>
            <span>v{row.version}</span>
          </p>
        </div>
      )}
      searchPlaceholder="Search master templates…"
      searchKeys={(row) => `${row.title} ${row.industry} ${row.master_disciplines?.name ?? ""}`}
      emptyMessage={rows.length === 0 ? "No master templates yet. Approve a proposal to add the first one." : "No templates match these filters."}
    />
    </div>
  );
}
