import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatLocationForDisplay } from "@/lib/checklists/location";
import { Badge } from "@/components/ui/badge";
import { INSPECTION_RECORDS_TABLE, IRNS_TABLE } from "@/lib/checklists/db-types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
} from "@/lib/registers/types";
import {
  computeCalibrationStatus,
  computePersonnelCertificationStatus,
  computeWelderStatus,
} from "@/lib/registers/status";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

const CAP = 200;
const ITEM_FETCH_CAP = 3000;
const TABS = [
  { key: "activities", label: "ITP activities" },
  { key: "inspections", label: "Inspections" },
  { key: "ncrs", label: "NCRs" },
  { key: "punch", label: "Punch closed" },
  { key: "registers", label: "Registers" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type ActStatus = "not_started" | "in_progress" | "inspected" | "signed_off" | "irn_issued";
const STATUS_META: Record<ActStatus, { label: string; tone: "neutral" | "info" | "warning" | "success" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "neutral" },
  inspected: { label: "Inspected", tone: "info" },
  signed_off: { label: "Signed off", tone: "warning" },
  irn_issued: { label: "IRN issued", tone: "success" },
};

interface ItemRow {
  id: string;
  item_number: string;
  activity: string;
  discipline: { code: string; name: string } | null;
  itp_sections: { section_number: number; itps: { id: string; itp_number: string; revision: number; status: string } };
  activity_party_intervention: { intervention: string }[] | null;
  activity_signoff_progress: { status: string }[] | null;
}
interface InspRow {
  id: string;
  record_number: string;
  itp_item_id: string;
  inspection_date: string;
  overall_result: string | null;
  itp_number: string;
  activity: string;
  irns: IrnEmbed[] | IrnEmbed | null;
}
interface IrnEmbed {
  irn_number: string;
  voided_at: string | null;
}
const irnsOf = (r: { irns: IrnEmbed[] | IrnEmbed | null }): IrnEmbed[] =>
  Array.isArray(r.irns) ? r.irns : r.irns ? [r.irns] : [];
const liveIrnOf = (r: { irns: IrnEmbed[] | IrnEmbed | null }): IrnEmbed | null => irnsOf(r).find((i) => !i.voided_at) ?? null;

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

function Empty({ text }: { text: string }) {
  return <p className="mt-4 rounded-md border border-border bg-background px-3 py-4 text-sm text-muted">{text}</p>;
}
function CapNote({ n }: { n: number }) {
  return n >= CAP ? <p className="mt-2 text-xs text-muted"><T>Showing latest</T> {CAP}.</p> : null;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-2 py-2 font-semibold">{children}</th>;
}
function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-start text-sm">
        <thead className="border-b border-border bg-background text-xs uppercase text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

/** Search params are optional: the parent view passes ?done= ?itp= ?disc= ?status= through. */
export async function DoneActivitiesPanel({
  projectId,
  done,
  itp,
  disc,
  status,
}: {
  projectId: string;
  done?: string;
  itp?: string;
  disc?: string;
  status?: string;
}) {
  const tl = await getTranslator();
  const tab: TabKey = (TABS.find((t) => t.key === done)?.key ?? "activities") as TabKey;
  const supabase = await createSupabaseServerClient();

  const [itemsRes, inspRes, ncrRes, punchRes, ncrClosedCnt, punchClosedCnt] = await Promise.all([
    supabase
      .from("itp_items")
      .select(
        "id, item_number, activity, discipline:master_disciplines(code, name), itp_sections!inner(section_number, itps!inner(id, itp_number, revision, status, project_id)), activity_party_intervention(intervention), activity_signoff_progress(status)"
      )
      .eq("itp_sections.itps.project_id", projectId)
      .in("itp_sections.itps.status", ["approved", "client_accepted"])
      .limit(ITEM_FETCH_CAP)
      .returns<ItemRow[]>(),
    supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id, record_number, itp_item_id, inspection_date, overall_result, itp_number, activity, irns(irn_number, voided_at)")
      .eq("project_id", projectId)
      .order("inspection_date", { ascending: false })
      .limit(ITEM_FETCH_CAP)
      .returns<InspRow[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("id, ncr_number, severity, status, description, closed_at, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(CAP)
      .returns<{ id: string; ncr_number: string; severity: string; status: string; description: string; closed_at: string | null; created_at: string }[]>(),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, location, closed_at, verification_notes")
      .eq("project_id", projectId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(CAP)
      .returns<{ id: string; description: string; location: string | null; closed_at: string | null; verification_notes: string | null }[]>(),
    supabase.from(NCRS_TABLE).select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "closed"),
    supabase.from(PUNCH_LIST_ITEMS_TABLE).select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "closed"),
  ]);

  const items = itemsRes.data ?? [];
  const allInsps = inspRes.data ?? [];
  // Drafts (no overall_result) are not completed inspections.
  const insps = allInsps.filter((r) => r.overall_result !== null);

  const inspByItem = new Map<string, InspRow>();
  for (const r of insps) if (!inspByItem.has(r.itp_item_id)) inspByItem.set(r.itp_item_id, r); // newest first
  const draftItems = new Set(allInsps.filter((r) => r.overall_result === null).map((r) => r.itp_item_id));

  const activities = items.map((it) => {
    const rec = inspByItem.get(it.id) ?? null;
    const irn = rec ? liveIrnOf(rec) : null;
    const prog = it.activity_signoff_progress ?? [];
    const signed = prog.length > 0 && prog.every((p) => p.status === "signed_off" || p.status === "proceeded_no_response");
    const st: ActStatus = irn
      ? "irn_issued"
      : signed
        ? "signed_off"
        : rec
          ? "inspected"
          : draftItems.has(it.id)
            ? "in_progress"
            : "not_started";
    return { it, rec, irn, st };
  });

  const doneCount = activities.filter((a) => a.st !== "not_started" && a.st !== "in_progress").length;
  const irnCount = insps.filter((r) => liveIrnOf(r)).length;

  // Filters (activities tab)
  const itpOptions = Array.from(new Map(items.map((i) => [i.itp_sections.itps.id, i.itp_sections.itps])).values()).sort((a, b) =>
    a.itp_number.localeCompare(b.itp_number)
  );
  const discOptions = Array.from(new Set(items.map((i) => i.discipline?.code).filter((x): x is string => !!x))).sort();
  const filtered = activities
    .filter((a) => !itp || a.it.itp_sections.itps.id === itp)
    .filter((a) => !disc || a.it.discipline?.code === disc)
    .filter((a) => !status || a.st === status)
    .sort(
      (x, y) =>
        x.it.itp_sections.itps.itp_number.localeCompare(y.it.itp_sections.itps.itp_number) ||
        x.it.itp_sections.section_number - y.it.itp_sections.section_number ||
        x.it.item_number.localeCompare(y.it.item_number, undefined, { numeric: true })
    );

  const tabHref = (k: string) => `?done=${k}#done-activities`;

  return (
    <section id="done-activities" className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-ink"><T>What was done — activity register</T></h2>
      <p className="mt-1 text-sm text-muted"><T>Everything completed on this project in one place.</T></p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { l: "Activities completed", v: `${doneCount} / ${activities.length}` },
          { l: "Inspections completed", v: String(insps.length) },
          { l: "IRNs issued", v: String(irnCount) },
          { l: "NCRs closed", v: String(ncrClosedCnt.count ?? 0) },
          { l: "Punch closed", v: String(punchClosedCnt.count ?? 0) },
        ].map((s) => (
          <div key={s.l} className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-lg font-semibold text-ink">{s.v}</div>
            <div className="text-xs text-muted">{s.l}</div>
          </div>
        ))}
      </div>

      <nav className="mt-4 flex flex-wrap gap-2" aria-label={tl("Done sections")}>
        {TABS.map((t) => (
          <a
            key={t.key}
            href={tabHref(t.key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              tab === t.key ? "border-burgundy bg-burgundy text-white" : "border-border text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {tab === "activities" && (
        <>
          <form method="get" action="#done-activities" className="mt-4 flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="done" value="activities" />
            <label className="flex flex-col text-xs text-muted">
              <T>ITP</T>
              <select name="itp" defaultValue={itp ?? ""} className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink">
                <option value=""><T>All ITPs</T></option>
                {itpOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.itp_number} <T>rev</T> {o.revision}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">
              <T>Discipline</T>
              <select name="disc" defaultValue={disc ?? ""} className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink">
                <option value=""><T>All</T></option>
                {discOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-muted">
              <T>Status</T>
              <select name="status" defaultValue={status ?? ""} className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink">
                <option value=""><T>All</T></option>
                {(Object.keys(STATUS_META) as ActStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-semibold text-white">
              <T>Apply</T>
            </button>
            {(itp || disc || status) && (
              <a href={tabHref("activities")} className="py-1.5 text-sm text-burgundy hover:underline">
                <T>Clear</T>
              </a>
            )}
          </form>
          {filtered.length === 0 ? (
            <Empty text={activities.length === 0 ? "No approved ITPs with activities yet." : "No activities match these filters."} />
          ) : (
            <>
              <Table
                head={
                  <>
                    <Th><T>ITP</T></Th>
                    <Th><T>Item</T></Th>
                    <Th><T>Activity</T></Th>
                    <Th><T>Disc.</T></Th>
                    <Th><T>Levels</T></Th>
                    <Th><T>State</T></Th>
                    <Th><T>Record</T></Th>
                    <Th><T>Date</T></Th>
                  </>
                }
              >
                {filtered.slice(0, CAP).map(({ it, rec, irn, st }) => (
                  <tr key={it.id} className="align-top">
                    <td className="whitespace-nowrap px-2 py-2">
                      <a href={`/inspect/itps/${it.itp_sections.itps.id}`} className="text-burgundy hover:underline">
                        {it.itp_sections.itps.itp_number}
                      </a>{" "}
                      <span className="text-xs text-muted"><T>rev</T> {it.itp_sections.itps.revision}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {it.itp_sections.section_number}.{it.item_number}
                    </td>
                    <td className="min-w-[12rem] px-2 py-2">{it.activity}</td>
                    <td className="px-2 py-2">{it.discipline?.code ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {Array.from(new Set((it.activity_party_intervention ?? []).map((p) => p.intervention))).join(" ") || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <Badge showIcon tone={STATUS_META[st].tone}>{STATUS_META[st].label}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {rec ? (
                        <a href={`/inspect/inspections/${rec.id}`} className="text-burgundy hover:underline">
                          {rec.record_number}
                        </a>
                      ) : (
                        "—"
                      )}
                      {irn && <div className="text-xs text-muted">{irn.irn_number}</div>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{fmt(rec?.inspection_date ?? null)}</td>
                  </tr>
                ))}
              </Table>
              {filtered.length > CAP && <p className="mt-2 text-xs text-muted"><T>Showing first</T> {CAP} <T>of</T> {filtered.length} <T>matching activities. Narrow with filters.</T></p>}
            </>
          )}
        </>
      )}

      {tab === "inspections" &&
        (insps.length === 0 ? (
          <Empty text="No inspections have been completed yet." />
        ) : (
          <>
            <Table head={<><Th><T>Record</T></Th><Th><T>ITP</T></Th><Th><T>Activity</T></Th><Th><T>Date</T></Th><Th><T>Result</T></Th><Th><T>IRN</T></Th></>}>
              {insps.slice(0, CAP).map((r) => {
                const irn = liveIrnOf(r);
                const voided = !irn && irnsOf(r).length > 0;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-2 py-2">
                      <a href={`/inspect/inspections/${r.id}`} className="text-burgundy hover:underline">{r.record_number}</a>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{r.itp_number}</td>
                    <td className="min-w-[12rem] px-2 py-2">{r.activity}</td>
                    <td className="whitespace-nowrap px-2 py-2">{fmt(r.inspection_date)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={r.overall_result === "pass" ? "success" : r.overall_result === "fail" ? "danger" : r.overall_result ? "warning" : "neutral"}>
                        {r.overall_result ?? "—"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{irn ? irn.irn_number : voided ? "Voided" : "—"}</td>
                  </tr>
                );
              })}
            </Table>
            <CapNote n={Math.min(insps.length, CAP)} />
          </>
        ))}

      {tab === "ncrs" &&
        ((ncrRes.data ?? []).length === 0 ? (
          <Empty text="No NCRs raised on this project." />
        ) : (
          <>
            <Table head={<><Th><T>NCR</T></Th><Th><T>Severity</T></Th><Th><T>Status</T></Th><Th><T>Description</T></Th><Th><T>Closed</T></Th></>}>
              {(ncrRes.data ?? []).map((n) => (
                <tr key={n.id} className="align-top">
                  <td className="whitespace-nowrap px-2 py-2">
                    <a href={`/inspect/ncrs/${n.id}`} className="text-burgundy hover:underline">{n.ncr_number}</a>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={n.severity === "major_ncr" ? "danger" : n.severity === "minor_ncr" ? "warning" : "neutral"}>{n.severity.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={n.status === "closed" ? "success" : "info"}>{n.status.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="min-w-[12rem] px-2 py-2">{n.description}</td>
                  <td className="whitespace-nowrap px-2 py-2">{fmt(n.closed_at)}</td>
                </tr>
              ))}
            </Table>
            <CapNote n={(ncrRes.data ?? []).length} />
          </>
        ))}

      {tab === "punch" &&
        ((punchRes.data ?? []).length === 0 ? (
          <Empty text="No punch items have been verified closed yet." />
        ) : (
          <>
            <Table head={<><Th><T>Item</T></Th><Th><T>Location</T></Th><Th><T>Verification</T></Th><Th><T>Closed</T></Th></>}>
              {(punchRes.data ?? []).map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="min-w-[12rem] px-2 py-2">
                    <a href={`/inspect/projects/${projectId}/punch-list`} className="text-burgundy hover:underline">{p.description}</a>
                  </td>
                  <td className="px-2 py-2">{formatLocationForDisplay(p.location)}</td>
                  <td className="px-2 py-2 text-muted">{p.verification_notes ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2">{fmt(p.closed_at)}</td>
                </tr>
              ))}
            </Table>
            <CapNote n={(punchRes.data ?? []).length} />
          </>
        ))}

      {tab === "registers" && <RegistersSection projectId={projectId} />}
    </section>
  );
}

async function RegistersSection({ projectId }: { projectId: string }) {
  const supabase = await createSupabaseServerClient();
  const [mats, welders, cals, certs] = await Promise.all([
    supabase.from(MATERIAL_REGISTER_TABLE).select("id, material_description, heat_number, batch_number, receipt_status").eq("project_id", projectId).eq("receipt_status", "released").order("created_at", { ascending: false }).limit(CAP).returns<{ id: string; material_description: string; heat_number: string | null; batch_number: string | null }[]>(),
    supabase.from(WELDER_QUALIFICATION_REGISTER_TABLE).select("id, welder_identifier, qualified_wps, expiry_date").eq("project_id", projectId).order("expiry_date", { ascending: false }).limit(CAP).returns<{ id: string; welder_identifier: string; qualified_wps: string; expiry_date: string }[]>(),
    supabase.from(CALIBRATION_REGISTER_TABLE).select("id, instrument_name, cert_number, due_date").eq("project_id", projectId).order("due_date", { ascending: false }).limit(CAP).returns<{ id: string; instrument_name: string; cert_number: string; due_date: string }[]>(),
    supabase.from(PERSONNEL_CERTIFICATIONS_TABLE).select("id, certification_type, cert_number, expiry_date").eq("project_id", projectId).order("expiry_date", { ascending: false }).limit(CAP).returns<{ id: string; certification_type: string; cert_number: string | null; expiry_date: string }[]>(),
  ]);
  const rows: { kind: string; label: string; detail: string; until: string | null }[] = [
    ...(mats.data ?? []).map((m) => ({ kind: "Material released", label: m.material_description, detail: [m.heat_number && `Heat ${m.heat_number}`, m.batch_number && `Batch ${m.batch_number}`].filter(Boolean).join(" · ") || "—", until: null })),
    ...(welders.data ?? []).filter((w) => computeWelderStatus(w.expiry_date) !== "expired").map((w) => ({ kind: "Welder", label: w.welder_identifier, detail: w.qualified_wps, until: w.expiry_date })),
    ...(cals.data ?? []).filter((c) => computeCalibrationStatus(c.due_date) !== "expired").map((c) => ({ kind: "Calibration", label: c.instrument_name, detail: c.cert_number, until: c.due_date })),
    ...(certs.data ?? []).filter((c) => computePersonnelCertificationStatus(c.expiry_date) !== "expired").map((c) => ({ kind: "Personnel cert", label: c.certification_type, detail: c.cert_number ?? "—", until: c.expiry_date })),
  ];
  if (rows.length === 0) return <Empty text="No valid register entries yet." />;
  return (
    <>
      <Table head={<><Th><T>Type</T></Th><Th><T>Entry</T></Th><Th><T>Detail</T></Th><Th><T>Valid until</T></Th></>}>
        {rows.map((r, i) => (
          <tr key={i} className="align-top">
            <td className="whitespace-nowrap px-2 py-2"><Badge tone="success">{r.kind}</Badge></td>
            <td className="min-w-[10rem] px-2 py-2">
              <a href={`/inspect/projects/${projectId}/registers`} className="text-burgundy hover:underline">{r.label}</a>
            </td>
            <td className="px-2 py-2 text-muted">{r.detail}</td>
            <td className="whitespace-nowrap px-2 py-2">{fmt(r.until)}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-muted"><T>Each register shows its latest</T> {CAP} <T>entries; expired entries are excluded.</T></p>
    </>
  );
}
