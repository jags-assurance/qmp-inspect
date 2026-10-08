"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
      <Link href={`/inspect/itp-master/${row.id}`} className="font-medium text-burgundy hover:underline">
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
    render: (row) => <Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Inactive"}</Badge>,
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
  const sel = "min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label={tl("Industry")} value={industry} onChange={(e) => setIndustry(e.target.value)} className={sel}>
          <option value=""><Tx>All industries</Tx></option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select aria-label={tl("Discipline")} value={discipline} onChange={(e) => setDiscipline(e.target.value)} className={sel}>
          <option value=""><Tx>All disciplines</Tx></option>
          {disciplines.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select aria-label={tl("Status")} value={active} onChange={(e) => setActive(e.target.value)} className={sel}>
          <option value=""><Tx>Active and inactive</Tx></option>
          <option value="active"><Tx>Active only</Tx></option>
          <option value="inactive"><Tx>Inactive only</Tx></option>
        </select>
      </div>
    <DataTable
      columns={COLUMNS}
      rows={filtered}
      searchPlaceholder="Search master templates…"
      searchKeys={(row) => `${row.title} ${row.industry} ${row.master_disciplines?.name ?? ""}`}
      emptyMessage={rows.length === 0 ? "No master templates yet. Approve a proposal to add the first one." : "No templates match these filters."}
    />
    </>
  );
}
