import type { DataBookReadiness } from "@/lib/databook/readiness";

interface Row {
  label: string;
  status: string;
  tone?: "ok" | "warn" | "bad" | "muted";
}
interface Part {
  title: string;
  rows: Row[];
}

const TONE: Record<NonNullable<Row["tone"]>, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
};

function fraction(ready: number, total: number, empty = "No records yet"): { status: string; tone: NonNullable<Row["tone"]> } {
  if (total === 0) return { status: empty, tone: "muted" };
  return { status: `${ready} of ${total}`, tone: ready === total ? "ok" : ready === 0 ? "bad" : "warn" };
}

/**
 * The Data Book page's own outline, in the same Part A–D order as the generated PDF (cover and
 * control sheets, evidence register, records, release controls), each line with its live status.
 * It answers "what will be in the book and how complete is each part" without opening the PDF.
 */
export function DataBookStructurePanel({
  readiness,
  partyCount,
  ncrTotal,
  ncrClosed,
  punchTotal,
  punchClosed,
  latestStatus,
  handoverIssued,
}: {
  readiness: DataBookReadiness;
  partyCount: number;
  ncrTotal: number;
  ncrClosed: number;
  punchTotal: number;
  punchClosed: number;
  latestStatus: "draft" | "compiled" | "issued" | null;
  handoverIssued: boolean;
}) {
  const itps = readiness.itps;
  const records = readiness.inspectionRecords;
  const checklists = readiness.checklists;
  const calibration = readiness.calibrationRegister;
  const welders = readiness.welderRegister;
  const materials = readiness.materialRegister;

  const parts: Part[] = [
    {
      title: "Part A — Document control",
      rows: [
        { label: "Cover, document control and authorization", status: latestStatus ? `Book ${latestStatus}` : "No book created", tone: latestStatus ? "ok" : "muted" },
        { label: "Revision, distribution and issue status", status: `${partyCount} part${partyCount === 1 ? "y" : "ies"} on the distribution register`, tone: partyCount ? "ok" : "muted" },
        { label: "Contents, scope and applicability", status: "Generated with the book", tone: "muted" },
      ],
    },
    {
      title: "Part B — Evidence register",
      rows: [
        {
          label: "Master record register (one row per ITP activity)",
          ...fraction(records.ready, records.total, "No ITP activities yet"),
        },
      ],
    },
    {
      title: "Part C — Records",
      rows: [
        { label: "Inspection and testing records — ITPs approved or accepted", ...fraction(itps.ready, itps.total) },
        { label: "Completed checklists", ...fraction(checklists.ready, checklists.total) },
        { label: "Materials and traceability — approved and released", ...fraction(materials.ready, materials.total) },
        { label: "Welding and joining — qualifications valid", ...fraction(welders.ready, welders.total) },
        { label: "Calibration certificates in date", ...fraction(calibration.ready, calibration.total) },
        { label: "Nonconformance, deviation and exceptions — closed", ...fraction(ncrClosed, ncrTotal, "None raised") },
        { label: "Mechanical completion and punch list — verified closed", ...fraction(punchClosed, punchTotal, "None raised") },
      ],
    },
    {
      title: "Part D — Release controls",
      rows: [
        {
          label: "Readiness calculations and hard gates",
          status: `${readiness.overallPercentage}% overall · ${readiness.isReady ? "ready" : "not ready"}`,
          tone: readiness.isReady ? "ok" : "warn",
        },
        { label: "Final completeness certification", status: latestStatus === "issued" ? "Issued" : "Unsigned until issued", tone: latestStatus === "issued" ? "ok" : "muted" },
        { label: "Final acceptance and handover record", status: handoverIssued ? "Handover certificate issued" : "Not issued", tone: handoverIssued ? "ok" : "muted" },
      ],
    },
  ];

  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-base font-medium text-ink">Book structure</h2>
      <p className="mt-1 text-xs text-muted">
        The generated Data Book follows this order. Each line shows where that part stands now — Draft, For review and Final differ only in which of these are complete and signed.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {parts.map((part) => (
          <section key={part.title} aria-label={part.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{part.title}</h3>
            <ul className="mt-1.5 divide-y divide-border rounded-md border border-border">
              {part.rows.map((row) => (
                <li key={row.label} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 text-ink">{row.label}</span>
                  <span className={`shrink-0 text-right text-xs font-medium ${TONE[row.tone ?? "muted"]}`}>{row.status}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
