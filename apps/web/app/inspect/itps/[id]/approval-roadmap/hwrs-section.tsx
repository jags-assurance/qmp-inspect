import { Badge } from "@/components/ui/badge";
import { toneClassForLevelIndex } from "@/lib/intervention-levels/types";

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
        <Badge tone="danger">Overdue {fmtDuration(elapsedH - (level?.noticeHours ?? 48))}</Badge>
      ) : bucket === "signed_off" ? (
        <Badge tone={point.status === "proceeded_no_response" ? "info" : "success"}>
          {point.status === "proceeded_no_response" ? "Proceeded" : "Signed off"}
        </Badge>
      ) : bucket === "notified" ? (
        <Badge tone="warning">Notified{point.notifiedAt ? ` · ${fmtDuration(elapsedH)}` : ""}</Badge>
      ) : (
        <Badge tone="neutral">Pending</Badge>
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

  const chipFor = (p: HwrsPoint) => {
    const entry = levelByCode.get(p.levelCode);
    return <PointChip point={p} level={entry?.level} levelIndex={entry?.index ?? 0} nowMs={nowMs} />;
  };

  return (
    <section className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">3. Intervention points — {levels.map((l) => l.code).join(" / ") || "H/W/R/S"}</h2>
      <p className="mt-1 text-xs text-muted">
        Every activity carries sign-off points per project party. Blocking levels hold work until cleared.
      </p>

      {/* Legend */}
      <div className="mt-3">
        <p className="text-xs font-medium text-muted">Levels in this organisation</p>
        {levels.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No intervention levels are configured.</p>
        ) : (
          <ul className="mt-1.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {levels.map((l, i) => (
              <li
                key={l.code}
                className={`flex items-start gap-2 rounded-md border p-2 ${l.isBlocking ? "border-burgundy/40 bg-burgundy/5" : "border-border"}`}
              >
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${toneClassForLevelIndex(i)}`}>{l.code}</span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-ink">{l.label}</p>
                  <p className="text-xs text-muted">
                    {l.isBlocking ? "Blocking" : "Non-blocking"} · {l.noticeHours}h notice
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {points.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">
          No sign-off points on this ITP yet. Assign H/W/R/S levels to project parties on the activities and they will appear here.
        </p>
      ) : (
        <>
          {/* Summary strip */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-muted">Summary</p>
              {overdueTotal > 0 ? (
                <Badge tone="danger">{overdueTotal} overdue</Badge>
              ) : (
                <Badge tone="success">Nothing overdue</Badge>
              )}
            </div>
            <div className="mt-1.5 overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[480px] text-start text-xs">
                <thead className="bg-off-white text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Level</th>
                    <th className="px-2 py-1.5 text-end font-medium">Points</th>
                    <th className="px-2 py-1.5 text-end font-medium">Signed off</th>
                    <th className="px-2 py-1.5 text-end font-medium">Notified</th>
                    <th className="px-2 py-1.5 text-end font-medium">Pending</th>
                    <th className="px-2 py-1.5 text-end font-medium">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.code} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        <span className="font-semibold text-ink">{s.code}</span>{" "}
                        <span className="text-muted">{s.level?.label ?? "(removed level)"}</span>
                        {s.level?.isBlocking && <span className="ms-1 text-burgundy">●</span>}
                      </td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{s.total}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums text-success">{s.signed}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums text-warning">{s.notified}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums text-muted">{s.pending}</td>
                      <td className={`px-2 py-1.5 text-end tabular-nums ${s.overdue > 0 ? "font-semibold text-danger" : "text-muted"}`}>
                        {s.overdue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* What is blocking */}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted">Blocking work right now ({blockers.length})</p>
            {blockers.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No blocking points are outstanding.</p>
            ) : (
              <div className="mt-1.5 overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[560px] text-start text-xs">
                  <thead className="bg-off-white text-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Activity</th>
                      <th className="px-2 py-1.5 font-medium">Waiting on</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockers.slice(0, 25).map((p) => (
                      <tr key={p.id} className={`border-t border-border ${isOverdue(p) ? "bg-danger/5" : ""}`}>
                        <td className="max-w-[16rem] px-2 py-1.5">
                          <span className="doc-id text-muted">{p.itemNumber}</span> <span className="break-words text-ink">{p.activity}</span>
                        </td>
                        <td className="px-2 py-1.5 text-ink">{partyById.get(p.partyId)?.name ?? "Unknown party"}</td>
                        <td className="px-2 py-1.5">{chipFor(p)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-muted">
                          {p.notifiedAt ? fmtDate(p.notifiedAt) : "Not yet notified"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {blockers.length > 25 && (
                  <p className="border-t border-border px-2 py-1.5 text-xs text-muted">Showing 25 of {blockers.length}; see the activity view below.</p>
                )}
              </div>
            )}
          </div>

          {/* Per-party */}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted">By party ({partyRows.length})</p>
            <div className="mt-1.5 space-y-1.5">
              {partyRows.map(({ id, party, ps }) => {
                const open = ps.filter((p) => bucketOf(p.status) !== "signed_off").length;
                const od = ps.filter(isOverdue).length;
                return (
                  <details key={id} className="rounded-md border border-border" open={od > 0}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-sm">
                      <span className="min-w-0 break-words font-medium text-ink">{party?.name ?? "Unknown party"}</span>
                      {party && <span className="text-xs text-muted">{titleCase(party.partyType)}{party.isActive ? "" : " · inactive"}</span>}
                      <span className="ms-auto flex items-center gap-1.5 text-xs text-muted">
                        {ps.length} points · {open} open
                        {od > 0 && <Badge tone="danger">{od} overdue</Badge>}
                      </span>
                    </summary>
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full min-w-[480px] text-start text-xs">
                        <tbody>
                          {[...ps]
                            .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }))
                            .map((p) => (
                              <tr key={p.id} className="border-t border-border first:border-t-0">
                                <td className="max-w-[18rem] px-2.5 py-1.5">
                                  <span className="doc-id text-muted">{p.itemNumber}</span> <span className="break-words text-ink">{p.activity}</span>
                                </td>
                                <td className="px-2 py-1.5">{chipFor(p)}</td>
                                <td className="px-2 py-1.5 text-muted">
                                  {p.signedOffAt ? `${p.signedOffByName ?? "—"} · ${fmtDate(p.signedOffAt)}` : ""}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          {/* Per-activity */}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted">By activity ({activities.length})</p>
            <div className="mt-1.5 max-h-[32rem] overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-start text-xs">
                <thead className="sticky top-0 bg-off-white text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Activity</th>
                    <th className="px-2 py-1.5 font-medium">Party</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 font-medium">Signed by</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) =>
                    a.points.map((p, i) => (
                      <tr key={p.id} className={`border-t ${i === 0 ? "border-border" : "border-border/50"}`}>
                        {i === 0 && (
                          <td rowSpan={a.points.length} className="max-w-[16rem] border-e border-border/50 px-2 py-1.5 align-top">
                            <span className="doc-id text-muted">{a.itemNumber}</span> <span className="break-words text-ink">{a.activity}</span>
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-ink">{partyById.get(p.partyId)?.name ?? "Unknown party"}</td>
                        <td className="px-2 py-1.5">{chipFor(p)}</td>
                        <td className="px-2 py-1.5 text-muted">
                          {p.signedOffAt ? `${p.signedOffByName ?? "—"} · ${fmtDate(p.signedOffAt)}` : p.proceededReason ?? ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
