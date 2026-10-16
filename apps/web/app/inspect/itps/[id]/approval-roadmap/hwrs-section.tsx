import { Badge } from "@/components/ui/badge";
import { toneClassForLevelIndex } from "@/lib/intervention-levels/types";
import { T } from "@/components/domain/t";
import { partyWithPeople } from "@/lib/itps/party-contacts";
import { Disclosure } from "@/components/ui/disclosure";
import { ResponsiveTable } from "@/components/ui/responsive-table";

export interface HwrsLevel {
  code: string;
  label: string;
  isBlocking: boolean;
  noticeHours: number;
}

export interface HwrsParty {
  id: string;
  name: string;
  partyType: string;
  isActive: boolean;
  /** Contact, linked login and team member names the viewer can read; empty when unknown. */
  people?: string[];
}

export interface HwrsPoint {
  id: string;
  itemId: string;
  itemNumber: string;
  activity: string;
  partyId: string;
  levelCode: string;
  status: string;
  notifiedAt: string | null;
  signedOffAt: string | null;
  signedOffByName: string | null;
  proceededReason: string | null;
}

type Bucket = "pending" | "notified" | "signed_off";

const bucketOf = (s: string): Bucket => (s === "notified" ? "notified" : s === "pending" ? "pending" : "signed_off");

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.floor(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** One level pill + its status chip + (for notified) waiting time. Status is shown in words, not colour alone. */
function PointChip({
  point,
  level,
  levelIndex,
  nowMs,
}: {
  point: HwrsPoint;
  level: HwrsLevel | undefined;
  levelIndex: number;
  nowMs: number;
}) {
  const blocking = level?.isBlocking ?? false;
  const bucket = bucketOf(point.status);
  const elapsedH = point.notifiedAt ? Math.max(0, (nowMs - new Date(point.notifiedAt).getTime()) / 3_600_000) : 0;
  const overdue = blocking && bucket === "notified" && !!point.notifiedAt && elapsedH > (level?.noticeHours ?? 48);

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        title={level ? `${level.label}${blocking ? " (blocking)" : ""}` : point.levelCode}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${toneClassForLevelIndex(levelIndex)} ${
          blocking ? "ring-1 ring-burgundy/50" : ""
        }`}
      >
        {point.levelCode}
        {blocking && <span aria-hidden>●</span>}
      </span>
      {overdue ? (
        <Badge tone="danger"><T>Overdue</T> {fmtDuration(elapsedH - (level?.noticeHours ?? 48))}</Badge>
      ) : bucket === "signed_off" ? (
        <Badge tone={point.status === "proceeded_no_response" ? "info" : "success"}>
          {point.status === "proceeded_no_response" ? "Proceeded" : "Signed off"}
        </Badge>
      ) : bucket === "notified" ? (
        <Badge tone="warning"><T>Notified</T>{point.notifiedAt ? ` · ${fmtDuration(elapsedH)}` : ""}</Badge>
      ) : (
        <Badge tone="neutral"><T>Pending</T></Badge>
      )}
    </span>
  );
}

export function HwrsSection({
  levels,
  parties,
  points,
  nowMs,
}: {
  levels: HwrsLevel[];
  parties: HwrsParty[];
  points: HwrsPoint[];
  nowMs: number;
}) {
  const levelByCode = new Map(levels.map((l, i) => [l.code, { level: l, index: i }] as const));
  const partyById = new Map(parties.map((p) => [p.id, p]));

  const isOverdue = (p: HwrsPoint) => {
    const lv = levelByCode.get(p.levelCode)?.level;
    return (
      !!lv?.isBlocking &&
      p.status === "notified" &&
      !!p.notifiedAt &&
      nowMs - new Date(p.notifiedAt).getTime() > lv.noticeHours * 3_600_000
    );
  };

  // Codes present in data but not in the org's list (deleted level) still get a row so counts add up.
  const codes = [...levels.map((l) => l.code), ...[...new Set(points.map((p) => p.levelCode))].filter((c) => !levelByCode.has(c))];

  const summary = codes.map((code) => {
    const ps = points.filter((p) => p.levelCode === code);
    return {
      code,
      level: levelByCode.get(code)?.level,
      total: ps.length,
      pending: ps.filter((p) => bucketOf(p.status) === "pending").length,
      notified: ps.filter((p) => bucketOf(p.status) === "notified").length,
      signed: ps.filter((p) => bucketOf(p.status) === "signed_off").length,
      overdue: ps.filter(isOverdue).length,
    };
  });

  // What is blocking right now: blocking-level points not yet signed off, oldest-notified first.
  const blockers = points
    .filter((p) => levelByCode.get(p.levelCode)?.level.isBlocking && bucketOf(p.status) !== "signed_off")
    .sort((a, b) => {
      const ao = isOverdue(a) ? 0 : 1;
      const bo = isOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const at = a.notifiedAt ? new Date(a.notifiedAt).getTime() : Infinity;
      const bt = b.notifiedAt ? new Date(b.notifiedAt).getTime() : Infinity;
      return at - bt;
    });
  const overdueTotal = points.filter(isOverdue).length;

  // Per-activity grouping
  const byItem = new Map<string, { itemNumber: string; activity: string; points: HwrsPoint[] }>();
  for (const p of points) {
    const g = byItem.get(p.itemId) ?? { itemNumber: p.itemNumber, activity: p.activity, points: [] };
    g.points.push(p);
    byItem.set(p.itemId, g);
  }
  const activities = [...byItem.values()].sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }));

  // Per-party grouping
  const byParty = new Map<string, HwrsPoint[]>();
  for (const p of points) byParty.set(p.partyId, [...(byParty.get(p.partyId) ?? []), p]);
  const partyRows = [...byParty.entries()]
    .map(([id, ps]) => ({ party: partyById.get(id), id, ps }))
    .sort((a, b) => (a.party?.name ?? "").localeCompare(b.party?.name ?? ""));

  const partyLabel = (id: string) => {
    const party = partyById.get(id);
    return party ? partyWithPeople(party.name, party.people ?? []) : "Unknown party";
  };

  const chipFor = (p: HwrsPoint) => {
    const entry = levelByCode.get(p.levelCode);
    return <PointChip point={p} level={entry?.level} levelIndex={entry?.index ?? 0} nowMs={nowMs} />;
  };

  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <h2 className="text-sm font-semibold text-ink"><T>3. Intervention points —</T> {levels.map((l) => l.code).join(" / ") || "H/W/R/S"}</h2>
      <p className="mt-1 text-xs text-muted">
        <T>Blocking levels hold work until cleared.</T>
      </p>

      {/* Legend */}
      <Disclosure variant="pill" summary={<><T>Levels in this organisation</T></>} className="mt-3">
        {levels.length === 0 ? (
          <p className="mt-1 text-sm text-muted"><T>No intervention levels are configured.</T></p>
        ) : (
          <ul className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {levels.map((l, i) => (
              <li
                key={l.code}
                className={`flex items-start gap-2 rounded-md border p-2 ${l.isBlocking ? "border-burgundy/40 bg-burgundy/5" : "border-border"}`}
              >
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${toneClassForLevelIndex(i)}`}>{l.code}</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-ink">{l.label}</p>
                  <p className="text-xs text-muted">
                    {l.isBlocking ? "Blocking" : "Non-blocking"} · {l.noticeHours}<T>h notice</T>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
</Disclosure>

      {points.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">
          <T>No sign-off points on this ITP yet.</T>
        </p>
      ) : (
        <>
          {/* Summary strip */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-muted"><T>Summary</T></p>
              {overdueTotal > 0 ? (
                <Badge tone="danger">{overdueTotal} <T>overdue</T></Badge>
              ) : (
                <Badge tone="success"><T>Nothing overdue</T></Badge>
              )}
            </div>
            <div className="mt-1.5 overflow-hidden rounded-md border border-border">
              <ResponsiveTable
                caption="Intervention points by level"
                rows={summary}
                rowKey={(r) => r.code}
                tableClassName="w-full text-start text-xs" headRowClassName="bg-surface-subtle text-start text-xs text-muted" thClassName="px-3 py-2 font-medium" tdClassName="px-3 py-2 align-top" rowClassName="border-t border-border" cardClassName="px-3" breakpoint="md" wrapperClassName="overflow-x-auto"
                columns={[
                  {
                    key: "level",
                    header: <T>Level</T>,
                    cardLabel: null,
                    render: (r) => (
                      <>
                        <span className="font-semibold text-ink">{r.code}</span>{" "}
                        <span className="text-muted">{r.level?.label ?? "(removed level)"}</span>
                        {r.level?.isBlocking && <span className="ms-1 text-burgundy" title="Blocking">● <span className="sr-only">Blocking</span></span>}
                      </>
                    ),
                  },
                  { key: "total", header: <T>Points</T>, cardLabel: "Points", className: "text-end tabular-nums", render: (r) => r.total },
                  { key: "signed", header: <T>Signed off</T>, cardLabel: "Signed off", className: "text-end tabular-nums text-success", render: (r) => r.signed },
                  { key: "notified", header: <T>Notified</T>, cardLabel: "Notified", className: "text-end tabular-nums text-warning", render: (r) => r.notified },
                  { key: "pending", header: <T>Pending</T>, cardLabel: "Pending", className: "text-end tabular-nums text-muted", render: (r) => r.pending },
                  {
                    key: "overdue",
                    header: <T>Overdue</T>,
                    cardLabel: "Overdue",
                    className: "text-end tabular-nums",
                    render: (r) => <span className={r.overdue > 0 ? "font-semibold text-danger" : "text-muted"}>{r.overdue}</span>,
                  },
                ]}
              />
            </div>
          </div>

          {/* What is blocking */}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted"><T>Blocking work right now (</T>{blockers.length})</p>
            {blockers.length === 0 ? (
              <p className="mt-1 text-sm text-muted"><T>No blocking points are outstanding.</T></p>
            ) : (
              <div className="mt-1.5 overflow-hidden rounded-md border border-border">
                <ResponsiveTable
                  caption="Blocking intervention points"
                  rows={blockers.slice(0, 25)}
                  rowKey={(p) => p.id}
                  tableClassName="w-full text-start text-xs" headRowClassName="bg-surface-subtle text-start text-xs text-muted" thClassName="px-3 py-2 font-medium" tdClassName="px-3 py-2 align-top" cardClassName="px-3" breakpoint="md" wrapperClassName="overflow-x-auto"
                  rowClassName={(p) => `border-t border-border ${isOverdue(p) ? "bg-danger/5" : ""}`}
                  columns={[
                    {
                      key: "activity",
                      header: <T>Activity</T>,
                      cardLabel: null,
                      tdClassName: "max-w-[16rem]",
                      render: (p) => (
                        <>
                          <span className="doc-id text-muted">{p.itemNumber}</span> <span className="break-words text-ink">{p.activity}</span>
                        </>
                      ),
                    },
                    { key: "waiting", header: <T>Waiting on</T>, cardLabel: "Waiting on", render: (p) => partyLabel(p.partyId) },
                    { key: "status", header: <T>Status</T>, cardLabel: "Status", render: (p) => chipFor(p) },
                    { key: "since", header: <T>Since</T>, cardLabel: "Since", className: "whitespace-nowrap text-muted", render: (p) => (p.notifiedAt ? fmtDate(p.notifiedAt) : "Not yet notified") },
                  ]}
                />
                {blockers.length > 25 && (
                  <p className="border-t border-border px-2 py-1.5 text-xs text-muted"><T>Showing 25 of</T> {blockers.length}<T>; see the activity view below.</T></p>
                )}
              </div>
            )}
          </div>

          {/* Per-party */}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted"><T>By party (</T>{partyRows.length})</p>
            <div className="mt-1.5 space-y-1.5">
              {partyRows.map(({ id, party, ps }) => {
                const open = ps.filter((p) => bucketOf(p.status) !== "signed_off").length;
                const od = ps.filter(isOverdue).length;
                return (
                  <details key={id} className="group rounded-md border border-border" open={od > 0}>
                    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-2 text-sm hover:bg-surface-subtle [&::-webkit-details-marker]:hidden">
<span aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-open:-rotate-90">›</span>
                      <span className="min-w-0 break-words font-medium text-ink">{party?.name ?? "Unknown party"}</span>
                      {party && <span className="text-xs text-muted">{titleCase(party.partyType)}{party.isActive ? "" : " · inactive"}</span>}
                      {party && (party.people?.length ?? 0) > 0 && (
                        <span className="min-w-0 break-words text-xs text-ink">{party.people!.join(", ")}</span>
                      )}
                      <span className="ms-auto flex items-center gap-1.5 text-xs text-muted">
                        {ps.length} <T>points ·</T> {open} <T>open</T>
                        {od > 0 && <Badge tone="danger">{od} <T>overdue</T></Badge>}
                      </span>
                    </summary>
                    <div className="border-t border-border">
                      <ResponsiveTable
                        caption="Intervention points for this party"
                        rows={[...ps].sort((x, y) => x.itemNumber.localeCompare(y.itemNumber, undefined, { numeric: true }))}
                        rowKey={(p) => p.id}
                        tableClassName="w-full text-start text-xs" headRowClassName="sr-only" thClassName="px-3 py-2 font-medium" tdClassName="px-3 py-2 align-top" rowClassName="border-t border-border" cardClassName="px-3" breakpoint="md" wrapperClassName="overflow-x-auto"
                        columns={[
                          {
                            key: "activity",
                            header: <T>Activity</T>,
                            cardLabel: null,
                            tdClassName: "max-w-[18rem]",
                            render: (p) => (
                              <>
                                <span className="doc-id text-muted">{p.itemNumber}</span> <span className="break-words text-ink">{p.activity}</span>
                              </>
                            ),
                          },
                          { key: "status", header: <T>Status</T>, cardLabel: "Status", render: (p) => chipFor(p) },
                          { key: "signed", header: <T>Signed by</T>, cardLabel: "Signed by", className: "text-muted", render: (p) => (p.signedOffAt ? `${p.signedOffByName ?? "—"} · ${fmtDate(p.signedOffAt)}` : "") },
                        ]}
                      />
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          {/* Per-activity */}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted"><T>By activity (</T>{activities.length})</p>
            <div className="mt-1.5 overflow-hidden rounded-md border border-border">
              <ResponsiveTable
                caption="Intervention points by activity"
                rows={activities.flatMap((x) => x.points.map((p, i) => ({ p, a: x, first: i === 0 })))}
                rowKey={(r) => r.p.id}
                tableClassName="w-full text-start text-xs" headRowClassName="bg-surface-subtle text-start text-xs text-muted" thClassName="px-3 py-2 font-medium" tdClassName="px-3 py-2 align-top" rowClassName="border-t border-border" cardClassName="px-3" breakpoint="md" wrapperClassName="overflow-x-auto"
                columns={[
                  {
                    key: "activity",
                    header: <T>Activity</T>,
                    cardLabel: null,
                    tdClassName: "max-w-[16rem]",
                    render: (r) => (
                      <>
                        <span className="doc-id text-muted">{r.a.itemNumber}</span> <span className="break-words text-ink">{r.a.activity}</span>
                      </>
                    ),
                  },
                  {
                    key: "party",
                    header: <T>Party</T>,
                    cardLabel: "Party",
                    render: (r) => (bucketOf(r.p.status) === "signed_off" ? partyLabel(r.p.partyId) : <><T>Waiting on</T> {partyLabel(r.p.partyId)}</>),
                  },
                  { key: "status", header: <T>Status</T>, cardLabel: "Status", render: (r) => chipFor(r.p) },
                  {
                    key: "signed",
                    header: <T>Signed by</T>,
                    cardLabel: "Signed by",
                    className: "text-muted",
                    render: (r) => (r.p.signedOffAt ? `${r.p.signedOffByName ?? "—"} · ${fmtDate(r.p.signedOffAt)}` : r.p.proceededReason ?? ""),
                  },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
