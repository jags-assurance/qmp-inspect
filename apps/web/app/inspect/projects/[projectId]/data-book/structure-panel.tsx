import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { DataBookReadiness } from "@/lib/databook/readiness";
import { MoreDetails } from "@/components/domain/more-details";
import { T } from "@/components/domain/t";

type Chip = "complete" | "partial" | "none" | "blocked";

interface Row {
  no: string;
  title: string;
  /** done / total (when countable) */
  ready?: number;
  total?: number;
  note?: string;
  chip?: Chip;
  href: string;
  external?: boolean;
}
interface Part {
  id: string;
  title: string;
  rows: Row[];
}

function chipOf(row: Row): Chip {
  if (row.chip) return row.chip;
  const { ready = 0, total = 0 } = row;
  if (total === 0) return "none";
  if (ready >= total) return "complete";
  return ready === 0 ? "none" : "partial";
}

const CHIP_TONE: Record<Chip, "success" | "warning" | "neutral" | "danger"> = {
  complete: "success",
  partial: "warning",
  none: "neutral",
  blocked: "danger",
};

function chipLabel(row: Row, chip: Chip): string {
  if (chip === "complete") return "Complete";
  if (chip === "blocked") return "Blocked";
  if (chip === "partial") return `${row.ready} of ${row.total}`;
  return row.total === 0 && row.note ? row.note : "Not started";
}

function pct(row: Row): string {
  if (row.total === undefined || row.total === 0) return "—";
  return `${Math.round(((row.ready ?? 0) / row.total) * 100)}%`;
}

/** Part structure shared by the sticky mini-nav and the index table. */
export function buildDataBookParts(args: {
  projectId: string;
  readiness: DataBookReadiness;
  partyCount: number;
  ncrTotal: number;
  ncrClosed: number;
  punchTotal: number;
  punchClosed: number;
  latestStatus: "draft" | "compiled" | "issued" | null;
  handoverIssued: boolean;
}): Part[] {
  const { projectId, readiness, partyCount, ncrTotal, ncrClosed, punchTotal, punchClosed, latestStatus, handoverIssued } = args;
  const base = `/inspect/projects/${projectId}`;
  const reg = `${base}/registers`;
  return [
    {
      id: "part-a",
      title: "Part A — Document control",
      rows: [
        { no: "A1", title: "Cover, document control and authorization", chip: latestStatus ? "complete" : "none", note: latestStatus ? undefined : "No book yet", href: "#generate" },
        { no: "A2", title: "Revision, distribution and issue status", ready: partyCount, total: partyCount, note: "No parties", href: "#project-summary" },
        { no: "A3", title: "Contents, scope and applicability", chip: latestStatus ? "complete" : "none", href: "#index" },
      ],
    },
    {
      id: "part-b",
      title: "Part B — Evidence register",
      rows: [
        { no: "B1", title: "Master record register (one row per ITP activity)", ...readiness.inspectionRecords, note: "No ITP activities", href: "#done" },
      ],
    },
    {
      id: "part-c",
      title: "Part C — Records",
      rows: [
        { no: "C1", title: "ITPs approved or accepted", ready: readiness.itps.ready, total: readiness.itps.total, href: `${base}/workspace`, external: true },
        { no: "C2", title: "Completed checklists", ready: readiness.checklists.ready, total: readiness.checklists.total, href: "/inspect/checklists", external: true },
        { no: "C3", title: "Inspection records / IRNs issued", ready: readiness.inspectionRecords.ready, total: readiness.inspectionRecords.total, href: "/inspect/inspections", external: true },
        { no: "C4", title: "Materials and traceability — approved and released", ready: readiness.materialRegister.ready, total: readiness.materialRegister.total, href: reg, external: true },
        { no: "C5", title: "Welding and joining — qualifications valid", ready: readiness.welderRegister.ready, total: readiness.welderRegister.total, href: reg, external: true },
        { no: "C6", title: "Calibration certificates in date", ready: readiness.calibrationRegister.ready, total: readiness.calibrationRegister.total, href: reg, external: true },
        { no: "C7", title: "Personnel certifications valid", ready: readiness.personnelRegister.ready, total: readiness.personnelRegister.total, note: "None recorded", href: reg, external: true },
        { no: "C7a", title: "Standalone inspections and FAT cleared", ready: readiness.standaloneAssignments.ready, total: readiness.standaloneAssignments.total, note: "None recorded", href: "/inspect/standalone", external: true },
        { no: "C8", title: "Nonconformances (NCRs) closed", ready: ncrClosed, total: ncrTotal, note: "None raised", href: "/inspect/ncrs", external: true },
        { no: "C9", title: "Punch list — verified closed", ready: punchClosed, total: punchTotal, note: "None raised", href: `${base}/punch-list`, external: true },
      ],
    },
    {
      id: "part-d",
      title: "Part D — Release controls",
      rows: [
        { no: "D1", title: "Readiness calculations and hard gates", ready: readiness.overallPercentage, total: 100, chip: readiness.isReady ? "complete" : readiness.overallPercentage === 0 ? "none" : "partial", href: "#gates" },
        { no: "D2", title: "Final completeness certification", chip: latestStatus === "issued" ? "complete" : "none", note: "Unsigned until issued", href: "#books" },
        { no: "D3", title: "Final acceptance and handover record", chip: handoverIssued ? "complete" : "none", note: "Not issued", href: "/inspect/handover", external: true },
      ],
    },
  ];
}

/**
 * Table-of-contents index of the book (Part A–D, same order as the generated PDF), each row with
 * section number, live status chip, % and a link to the detail or source page.
 */
export function DataBookIndex({ parts }: { parts: Part[] }) {
  return (
    <section id="index" aria-labelledby="index-h" className="scroll-mt-24 rounded-lg border border-border bg-surface p-4">
      <h2 id="index-h" className="text-base font-medium text-ink">
        <T>Index</T>
      </h2>
      <MoreDetails label="Show all sections" bare className="mt-1">
      <div className="space-y-4 md:hidden">
        {parts.map((part) => (
          <div key={part.id} className="scroll-mt-24">
            <h3 className="bg-surface-subtle px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{part.title}</h3>
            <ul className="divide-y divide-border">
              {part.rows.map((row) => {
                const chip = chipOf(row);
                return (
                  <li key={row.no} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="font-mono text-xs text-muted">{row.no}</span>
                    <span className="min-w-0 flex-1 text-ink">{row.title}</span>
                    <Badge tone={CHIP_TONE[chip]}>{chipLabel(row, chip)}</Badge>
                    <span className="text-xs tabular-nums text-muted">{pct(row)}</span>
                    {row.href.startsWith("#") ? (
                      <a href={row.href} className="inline-flex min-h-11 items-center text-burgundy hover:underline" aria-label={`Jump to ${row.title}`}>
                        <T>Jump ↓</T>
                      </a>
                    ) : (
                      <Link href={row.href} className="inline-flex min-h-11 items-center text-burgundy hover:underline" aria-label={`Open source for ${row.title}`}>
                        <T>Open →</T>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-start text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="w-12 py-1.5 pe-2 font-medium"><T>No.</T></th>
              <th scope="col" className="py-1.5 pe-2 font-medium"><T>Section</T></th>
              <th scope="col" className="py-1.5 pe-2 font-medium"><T>Status</T></th>
              <th scope="col" className="w-14 py-1.5 pe-2 text-end font-medium">%</th>
              <th scope="col" className="w-16 py-1.5 text-end font-medium"><T>Open</T></th>
            </tr>
          </thead>
          {parts.map((part) => (
            <tbody key={part.id} id={part.id} className="scroll-mt-24 border-t border-border">
              <tr>
                <th colSpan={5} scope="colgroup" className="bg-off-white px-2 py-1.5 text-start text-xs font-semibold uppercase tracking-wide text-muted">
                  {part.title}
                </th>
              </tr>
              {part.rows.map((row) => {
                const chip = chipOf(row);
                return (
                  <tr key={row.no} className="border-t border-border">
                    <td className="py-2 pe-2 font-mono text-xs text-muted">{row.no}</td>
                    <td className="py-2 pe-2 text-ink">{row.title}</td>
                    <td className="py-2 pe-2">
                      <Badge tone={CHIP_TONE[chip]}>{chipLabel(row, chip)}</Badge>
                    </td>
                    <td className="py-2 pe-2 text-end tabular-nums text-muted">{pct(row)}</td>
                    <td className="py-2 text-end">
                      {row.href.startsWith("#") ? (
                        <a href={row.href} className="text-burgundy hover:underline" aria-label={`Jump to ${row.title}`}>
                          <T>Jump ↓</T>
                        </a>
                      ) : (
                        <Link href={row.href} className="text-burgundy hover:underline" aria-label={`Open source for ${row.title}`}>
                          <T>Open →</T>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      </MoreDetails>
    </section>
  );
}

const NAV: { href: string; label: string }[] = [
  { href: "#status", label: "Status" },
  { href: "#index", label: "Index" },
  { href: "#gates", label: "Ready to generate?" },
  { href: "#generate", label: "Generate" },
  { href: "#books", label: "Books and revisions" },
  { href: "#project-summary", label: "Project summary" },
  { href: "#done", label: "What was done" },
  { href: "#disciplines", label: "Disciplines" },
  { href: "#updates", label: "Updates" },
];

/** Sticky mini-nav: a left rail on desktop, a horizontally scrolling bar on mobile. */
export function DataBookMiniNav() {
  return (
    <nav aria-label="Data Book sections" className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top))] z-10 -mx-1 overflow-x-auto bg-off-white/95 px-1 py-2 backdrop-blur lg:static lg:mx-0 lg:overflow-visible lg:bg-transparent lg:p-0">
      <ul className="flex gap-1 lg:sticky lg:top-4 lg:flex-col">
        {NAV.map((n) => (
          <li key={n.href} className="shrink-0">
            <a
              href={n.href}
              className={cn(
                "whitespace-nowrap inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted hover:bg-surface hover:text-burgundy",
                "focus:outline-none focus:ring-2 focus:ring-burgundy"
              )}
            >
              {n.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** @deprecated kept so older imports keep compiling; the page uses DataBookIndex. */
export const DataBookStructurePanel = DataBookIndex;
